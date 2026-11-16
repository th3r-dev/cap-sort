import fixWebmDuration from "fix-webm-duration";
import { AUDIO_BITRATE, FrameParser, pickMimeType, scaleRect, videoBitrate, type Rect, type Size } from "./util.ts";

export interface Source { id: string; name: string; thumb: string; kind: "screen" | "window" }

export interface CaptureOptions {
	fps: number;
	mic: boolean;
	systemAudio: boolean;
	/** Path to the Rust helper. Set only when the cursor must be hidden: Chromium always draws it. */
	helper?: string;
	rect?: Rect;
	preview?: Size;
}

export interface Capture {
	stream: MediaStream;
	/** Encoded size, known once the first frame arrives. */
	size: Size;
	/** Fires when the source goes away (window closed, display unplugged, helper died). */
	ended: Promise<void>;
	warnings: string[];
	stop(): void;
}

// Not in lib.dom yet; Chromium has shipped both since v94.
declare const MediaStreamTrackProcessor: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };
declare const MediaStreamTrackGenerator: new (o: { kind: "video" }) => MediaStreamTrack & { writable: WritableStream<VideoFrame> };

const MAX = { w: 1920, h: 1200 }; // "medium": never encode above 1080p-ish, Retina screens included

export async function listSources(remote: any, kind: Source["kind"], thumb: { width: number; height: number }): Promise<Source[]> {
	const list = await remote.desktopCapturer.getSources({ types: [kind], thumbnailSize: thumb, fetchWindowIcons: false });
	return list.map((s: any) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL(), kind }));
}

export async function openCapture(remote: any, src: Source, o: CaptureOptions): Promise<Capture> {
	const cleanups: (() => void)[] = [];
	const warnings: string[] = [];
	const stop = () => cleanups.splice(0).forEach((f) => f());
	try {
		// Chromium gives us system audio, and the video too unless the helper takes over.
		const display = !o.helper || o.systemAudio ? await displayMedia(remote, src, o) : null;
		display?.getTracks().forEach((t) => cleanups.push(() => t.stop()));
		if (o.systemAudio && !display?.getAudioTracks().length) warnings.push("System audio isn't available on this OS, so it won't be recorded.");

		let video: Video = o.helper ? helperVideo(o.helper, src, o.fps) : chromiumVideo(display!.getVideoTracks()[0]);
		if (o.helper) display?.getVideoTracks().forEach((t) => t.stop());
		if (o.rect && o.preview) video = cropVideo(video, o.rect, o.preview);
		cleanups.push(video.stop);

		const audio: MediaStreamTrack[] = [...(display?.getAudioTracks() ?? [])];
		if (o.mic) {
			try {
				const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
				mic.getTracks().forEach((t) => cleanups.push(() => t.stop()));
				audio.push(...mic.getAudioTracks());
			} catch (e) {
				warnings.push("Couldn't open the microphone, so it won't be recorded.");
			}
		}
		const mixed = mixAudio(audio);
		if (mixed) cleanups.push(mixed.stop);

		const size = await video.size;
		return { stream: new MediaStream([video.track, ...(mixed ? [mixed.track] : [])]), size, ended: video.ended, warnings, stop };
	} catch (e) {
		stop();
		throw e;
	}
}

/**
 * Obsidian never registers a display-media handler, so getDisplayMedia() throws NotSupportedError.
 * We register one for this call only and answer with the picked source (+ system audio via loopback).
 */
async function displayMedia(remote: any, src: Source, o: CaptureOptions): Promise<MediaStream> {
	const ses = remote.session.defaultSession;
	ses.setDisplayMediaRequestHandler((_req: unknown, cb: (r: unknown) => void) =>
		cb({ video: { id: src.id, name: src.name }, ...(o.systemAudio ? { audio: "loopback" } : {}) }));
	try {
		return await navigator.mediaDevices.getDisplayMedia({
			video: { width: { max: MAX.w }, height: { max: MAX.h }, frameRate: o.fps },
			// Voice processing ruins music and app sounds; leave system audio untouched.
			audio: o.systemAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
		});
	} finally {
		ses.setDisplayMediaRequestHandler(null);
	}
}

interface Video { track: MediaStreamTrack; size: Promise<Size>; ended: Promise<void>; stop(): void }

function chromiumVideo(track: MediaStreamTrack): Video {
	const s = track.getSettings();
	return {
		track,
		size: Promise.resolve({ w: s.width ?? MAX.w, h: s.height ?? MAX.h }),
		ended: new Promise((r) => track.addEventListener("ended", () => r(), { once: true })),
		stop: () => track.stop(),
	};
}

/** Frames from the Rust helper (captures without the cursor) turned into a MediaStreamTrack. */
function helperVideo(bin: string, src: Source, fps: number): Video {
	const { spawn } = (window as any).require("child_process");
	const [kind, id] = src.id.split(":"); // Chromium ids look like "screen:1:0" / "window:21320:0"
	const proc = spawn(bin, ["capture", kind, id, "--fps", String(fps), "--max-width", String(MAX.w)], { stdio: ["pipe", "pipe", "pipe"] });
	const gen = new MediaStreamTrackGenerator({ kind: "video" });
	const writer = gen.writable.getWriter();
	const parser = new FrameParser();
	let stderr = "";
	let gotSize: (s: Size) => void, failed: (e: Error) => void, ended: () => void;
	const size = new Promise<Size>((res, rej) => { gotSize = res; failed = rej; });
	const done = new Promise<void>((r) => (ended = r));

	proc.stdout.on("data", (chunk: Uint8Array) => {
		for (const f of parser.push(chunk)) {
			gotSize({ w: f.w, h: f.h });
			// ponytail: drops frames when the encoder lags; a bounded queue would smooth bursts if that shows up.
			if ((writer.desiredSize ?? 1) <= 0) continue;
			const frame = new VideoFrame(f.data, { format: f.format, codedWidth: f.w, codedHeight: f.h, timestamp: Math.round(performance.now() * 1000) });
			writer.write(frame).catch(() => {}).finally(() => frame.close());
		}
	});
	proc.stderr.on("data", (d: Uint8Array) => (stderr += new TextDecoder().decode(d)));
	proc.on("error", (e: Error) => failed(e));
	proc.on("exit", (code: number | null) => {
		failed(new Error(stderr.trim() || `cursor helper exited with code ${code}`));
		writer.close().catch(() => {});
		ended();
	});
	return {
		track: gen,
		size,
		ended: done,
		stop: () => { proc.stdin.end(); gen.stop(); },
	};
}

/** Crop every frame to `rect` (preview pixels). Works on frames, not rendering, so it keeps going while Obsidian is in the background. */
function cropVideo(v: Video, rect: Rect, preview: Size): Video {
	const gen = new MediaStreamTrackGenerator({ kind: "video" });
	let crop: Rect | null | undefined;
	let gotSize: (s: Size) => void;
	const size = new Promise<Size>((r) => (gotSize = r));
	new MediaStreamTrackProcessor({ track: v.track }).readable
		.pipeThrough(new TransformStream<VideoFrame, VideoFrame>({
			transform(frame, out) {
				const vis = frame.visibleRect!;
				crop ??= scaleRect(rect, preview, { w: vis.width, h: vis.height });
				gotSize(crop ? { w: crop.w, h: crop.h } : { w: vis.width, h: vis.height });
				out.enqueue(crop
					? new VideoFrame(frame, { visibleRect: { x: vis.x + even(crop.x), y: vis.y + even(crop.y), width: crop.w, height: crop.h } })
					: frame.clone());
				frame.close();
			},
		}))
		.pipeTo(gen.writable)
		.catch(() => gen.stop());
	return { track: gen, size, ended: v.ended, stop: () => { v.stop(); gen.stop(); } };
}

/** MediaRecorder keeps only the first audio track, so mic + system audio are mixed into one. */
function mixAudio(tracks: MediaStreamTrack[]): { track: MediaStreamTrack; stop(): void } | null {
	if (!tracks.length) return null;
	const ctx = new AudioContext();
	const dest = ctx.createMediaStreamDestination();
	for (const t of tracks) ctx.createMediaStreamSource(new MediaStream([t])).connect(dest);
	return { track: dest.stream.getAudioTracks()[0], stop: () => void ctx.close() };
}

export interface Recording { stop(): Promise<Blob> }

export function record(c: Capture, fps: number): Recording {
	const audio = c.stream.getAudioTracks().length > 0;
	const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t), audio);
	const rec = new MediaRecorder(c.stream, {
		...(mimeType ? { mimeType } : {}),
		videoBitsPerSecond: videoBitrate(c.size, fps),
		...(audio ? { audioBitsPerSecond: AUDIO_BITRATE } : {}),
	});
	const chunks: Blob[] = [];
	const t0 = Date.now();
	rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
	const done = new Promise<Blob>((resolve) => {
		rec.onstop = async () => {
			const blob = new Blob(chunks, { type: rec.mimeType || "video/webm" });
			// MediaRecorder leaves Duration out of the WebM header, so players can't seek without this.
			resolve(await fixWebmDuration(blob, Date.now() - t0, { logger: false }));
		};
	});
	rec.start(1000);
	return {
		stop() {
			if (rec.state !== "inactive") rec.stop();
			c.stop();
			return done;
		},
	};
}

const even = (v: number) => Math.floor(v / 2) * 2;
