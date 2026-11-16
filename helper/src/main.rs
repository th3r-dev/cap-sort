//! cap-sort-helper: captures one screen or window *without the cursor* (Chromium can't) and streams raw frames.
//!
//!   cap-sort-helper list
//!       → JSON: [{"kind":"screen"|"window","id":123,"title":"…"}]
//!   cap-sort-helper capture <screen|window> <id> [--cursor] [--fps N] [--max-width N]
//!       → stdout: per frame, a 16-byte little-endian header [width, height, format, 0] then width*height*4 bytes.
//!         format: 0 = BGRA, 1 = BGRX, 2 = RGBA, 3 = RGBX (the names WebCodecs' VideoFrame takes).
//!       Exits when stdin closes, so it never outlives the plugin.
//!
//! Encoding, cropping and audio stay in the plugin; this only replaces the video source.

use scap::capturer::{Capturer, Options, Resolution};
use scap::frame::{Frame, FrameType, VideoFrame};
use scap::Target;
use std::io::{Read, Write};
use std::process::exit;

fn main() {
	let args: Vec<String> = std::env::args().skip(1).collect();
	match args.first().map(String::as_str) {
		Some("list") => list(),
		Some("capture") => capture(&args[1..]),
		_ => fail(2, "usage: cap-sort-helper list | capture <screen|window> <id> [--cursor] [--fps N] [--max-width N]"),
	}
}

fn fail(code: i32, msg: &str) -> ! {
	eprintln!("{msg}");
	exit(code)
}

fn ensure_permission() {
	if !scap::is_supported() {
		fail(3, "screen capture is not supported on this OS version");
	}
	if !scap::has_permission() {
		fail(4, "screen recording permission is off");
	}
}

fn target_info(t: &Target) -> (&'static str, u32, &str) {
	match t {
		Target::Display(d) => ("screen", d.id, &d.title),
		Target::Window(w) => ("window", w.id, &w.title),
	}
}

fn list() {
	ensure_permission();
	let items: Vec<_> = scap::get_all_targets()
		.iter()
		.map(|t| {
			let (kind, id, title) = target_info(t);
			serde_json::json!({ "kind": kind, "id": id, "title": title })
		})
		.collect();
	println!("{}", serde_json::Value::Array(items));
}

fn capture(args: &[String]) {
	ensure_permission();
	let (kind, id) = match (args.first(), args.get(1).and_then(|s| s.parse::<u32>().ok())) {
		(Some(k), Some(id)) if k == "screen" || k == "window" => (k.as_str(), id),
		_ => fail(2, "capture needs <screen|window> <id>"),
	};
	let flag = |name: &str| args.iter().position(|a| a == name);
	let num = |name: &str, default: u32| flag(name).and_then(|i| args.get(i + 1)?.parse().ok()).unwrap_or(default);
	let show_cursor = flag("--cursor").is_some();
	let fps = num("--fps", 30);
	let max_width = num("--max-width", 1920);

	let target = scap::get_all_targets()
		.into_iter()
		.find(|t| target_info(t).0 == kind && target_info(t).1 == id)
		.unwrap_or_else(|| fail(5, &format!("{kind} {id} not found")));

	let options = |res| Options {
		fps,
		show_cursor,
		show_highlight: false,
		target: Some(target.clone()),
		output_type: FrameType::BGRAFrame,
		output_resolution: res,
		..Default::default()
	};
	// Build once at native size to learn it; rebuild downscaled if it's wider than we want to encode.
	let mut cap = Capturer::build(options(Resolution::Captured)).unwrap_or_else(|e| fail(6, &format!("{e}")));
	let [w, _] = cap.get_output_frame_size();
	if w > max_width {
		let res = match max_width {
			0..=640 => Resolution::_480p,
			641..=1280 => Resolution::_720p,
			1281..=1920 => Resolution::_1080p,
			_ => Resolution::_1440p,
		};
		cap = Capturer::build(options(res)).unwrap_or_else(|e| fail(6, &format!("{e}")));
	}

	// Plugin closes stdin to stop us (and the OS closes it if Obsidian dies).
	std::thread::spawn(|| {
		let _ = std::io::stdin().read_to_end(&mut Vec::new());
		exit(0);
	});

	cap.start_capture();
	let mut out = std::io::BufWriter::with_capacity(1 << 20, std::io::stdout().lock());
	loop {
		let frame = match cap.get_next_frame() {
			Ok(Frame::Video(v)) => v,
			Ok(_) => continue,
			Err(_) => break, // capture ended: window closed, display gone
		};
		let Some((w, h, fmt, data)) = packed(frame) else { continue };
		let mut header = [0u8; 16];
		header[0..4].copy_from_slice(&w.to_le_bytes());
		header[4..8].copy_from_slice(&h.to_le_bytes());
		header[8..12].copy_from_slice(&fmt.to_le_bytes());
		if out.write_all(&header).and_then(|_| out.write_all(&data)).and_then(|_| out.flush()).is_err() {
			break; // plugin went away
		}
	}
	cap.stop_capture();
}

/// Normalise every scap frame type to 4 bytes per pixel in a layout VideoFrame accepts.
fn packed(frame: VideoFrame) -> Option<(u32, u32, u32, Vec<u8>)> {
	let (w, h, fmt, data) = match frame {
		VideoFrame::BGRA(f) => (f.width, f.height, 0, f.data),
		VideoFrame::BGRx(f) => (f.width, f.height, 1, f.data),
		VideoFrame::BGR0(f) => (f.width, f.height, 1, f.data),
		VideoFrame::RGBx(f) => (f.width, f.height, 3, f.data),
		VideoFrame::XBGR(f) => (f.width, f.height, 3, f.data.chunks_exact(4).flat_map(|p| [p[3], p[2], p[1], 0]).collect()),
		VideoFrame::RGB(f) => (f.width, f.height, 3, f.data.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 0]).collect()),
		VideoFrame::YUVFrame(_) => return None, // we always ask for BGRA
	};
	let (w, h) = (w as u32, h as u32);
	// scap sends a 0×0 frame when nothing changed on macOS; drop it and any short buffer.
	(w > 0 && h > 0 && data.len() >= (w * h * 4) as usize).then_some((w, h, fmt, data))
}
