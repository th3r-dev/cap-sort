import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameParser, Mp3Writer, addWebmDuration, errText, fileName, formatElapsed, getRemote, helperName, joinPath, outputPaths, pickMimeType, scaleRect, videoBitrate, webmDuration } from "./util.ts";

void test("T-2 getRemote throws a clear error without electron.remote", () => {
	assert.throws(() => getRemote(() => ({})), /desktop Obsidian/);
	assert.throws(() => getRemote(() => { throw new Error("no require"); }), /desktop Obsidian/);
	const remote = { desktopCapturer: {}, session: {} };
	assert.equal(getRemote(() => ({ remote })), remote);
});

void test("T-5 scaleRect maps preview pixels to source pixels", () => {
	const r = scaleRect({ x: 100, y: 50, w: 200, h: 100 }, { w: 400, h: 225 }, { w: 1920, h: 1080 });
	assert.deepEqual(r, { x: 480, y: 240, w: 960, h: 480 });
});

void test("T-6 scaleRect normalises reversed drags and clamps to the source", () => {
	const r = scaleRect({ x: 400, y: 225, w: -100, h: -50 }, { w: 400, h: 225 }, { w: 1920, h: 1080 });
	assert.deepEqual(r, { x: 1440, y: 840, w: 480, h: 240 });
	const c = scaleRect({ x: -50, y: 200, w: 600, h: 100 }, { w: 400, h: 225 }, { w: 1920, h: 1080 });
	assert.deepEqual(c, { x: 0, y: 960, w: 1920, h: 120 });
});

void test("T-7 scaleRect rounds size down to even numbers", () => {
	const r = scaleRect({ x: 0, y: 0, w: 101, h: 51 }, { w: 1000, h: 1000 }, { w: 1000, h: 1000 });
	assert.deepEqual(r, { x: 0, y: 0, w: 100, h: 50 });
});

void test("T-8 scaleRect returns null for a click or a tiny drag", () => {
	assert.equal(scaleRect({ x: 10, y: 10, w: 0, h: 0 }, { w: 400, h: 225 }, { w: 1920, h: 1080 }), null);
	assert.equal(scaleRect({ x: 10, y: 10, w: 1, h: 30 }, { w: 400, h: 225 }, { w: 1920, h: 1080 }), null);
});

void test("T-12 fileName uses local time, zero-padded", () => {
	assert.equal(fileName(new Date(2026, 0, 2, 3, 4, 5)), "cap-20260102-030405");
});

void test("T-13/T-14 pickMimeType prefers AV1, then VP9, VP8, then default; adds Opus with audio", () => {
	assert.equal(pickMimeType(() => true, false), "video/webm;codecs=av01");
	assert.equal(pickMimeType(() => true, true), "video/webm;codecs=av01,opus");
	assert.equal(pickMimeType((t) => t === "video/webm;codecs=vp8,opus", true), "video/webm;codecs=vp8,opus");
	assert.equal(pickMimeType(() => false, true), "");
});

void test("T-15 joinPath trims slashes and handles an empty folder", () => {
	assert.equal(joinPath("Recordings/", "x.webm"), "Recordings/x.webm");
	assert.equal(joinPath(" /a/b/ ", "x.webm"), "a/b/x.webm");
	assert.equal(joinPath("", "x.webm"), "x.webm");
});

void test("T-21 formatElapsed shows mm:ss", () => {
	assert.equal(formatElapsed(65_000), "01:05");
	assert.equal(formatElapsed(0), "00:00");
});

void test("errText handles Error objects and remote string rejections", () => {
	assert.equal(errText(new Error("boom")), "boom");
	assert.equal(errText("Failed to get sources."), "Failed to get sources.");
});

void test("T-22 videoBitrate: medium quality, clamped", () => {
	assert.equal(videoBitrate({ w: 1920, h: 1080 }, 30), 1_555_200);
	assert.equal(videoBitrate({ w: 320, h: 240 }, 30), 250_000);
	assert.equal(videoBitrate({ w: 3840, h: 2160 }, 60), 2_500_000);
});

void test("T-23 helperName per platform", () => {
	assert.equal(helperName("darwin", "arm64"), "cap-sort-helper-darwin-arm64");
	assert.equal(helperName("win32", "x64"), "cap-sort-helper-win32-x64.exe");
});

function frameBytes(w: number, h: number, format: number, fill: number): Uint8Array {
	const b = new Uint8Array(16 + w * h * 4);
	const v = new DataView(b.buffer);
	v.setUint32(0, w, true); v.setUint32(4, h, true); v.setUint32(8, format, true);
	b.fill(fill, 16);
	return b;
}

void test("T-24 FrameParser reassembles frames split at any byte", () => {
	const stream = new Uint8Array([...frameBytes(2, 2, 0, 7), ...frameBytes(4, 1, 3, 9)]);
	for (const step of [1, 5, 16, 17, stream.length]) {
		const p = new FrameParser();
		const frames = [];
		for (let i = 0; i < stream.length; i += step) frames.push(...p.push(stream.subarray(i, i + step)));
		assert.equal(frames.length, 2, `step ${step}`);
		assert.deepEqual([frames[0].w, frames[0].h, frames[0].format, frames[0].data[15]], [2, 2, "BGRA", 7]);
		assert.deepEqual([frames[1].w, frames[1].h, frames[1].format, frames[1].data.length], [4, 1, "RGBX", 16]);
	}
});

void test("T-25 FrameParser rejects a corrupt header", () => {
	assert.throws(() => new FrameParser().push(frameBytes(2, 2, 9, 0)), /bad frame header/);
});

void test("pickMimeType for MP4 prefers H.264 + AAC, then Opus, then VP9, then bare MP4", () => {
	assert.equal(pickMimeType(() => true, true, "mp4"), "video/mp4;codecs=avc1,mp4a.40.2");
	assert.equal(pickMimeType((t) => t !== "video/mp4;codecs=avc1,mp4a.40.2", true, "mp4"), "video/mp4;codecs=avc1,opus");
	assert.equal(pickMimeType(() => true, false, "mp4"), "video/mp4;codecs=avc1");
	assert.equal(pickMimeType((t) => t === "video/mp4", false, "mp4"), "video/mp4");
	assert.equal(pickMimeType((t) => t.startsWith("video/webm"), true, "mp4"), "");
});

void test("outputPaths: flat without MP3, a folder per recording with MP3", () => {
	assert.deepEqual(outputPaths("Recordings", "cap-1", "webm", false), { video: "Recordings/cap-1.webm" });
	assert.deepEqual(outputPaths("/Recordings/", "cap-1", "mp4", true), { dir: "Recordings/cap-1", video: "Recordings/cap-1/cap-1.mp4", audio: "Recordings/cap-1/cap-1.mp3" });
	assert.deepEqual(outputPaths("", "cap-1", "webm", true), { dir: "cap-1", video: "cap-1/cap-1.webm", audio: "cap-1/cap-1.mp3" });
});

void test("Mp3Writer turns a second of sine into MP3 frames", () => {
	const rate = 48000, w = new Mp3Writer(2, rate);
	for (let i = 0; i < rate; i += 4096) {
		const n = Math.min(4096, rate - i);
		w.push(Float32Array.from({ length: n }, (_, k) => Math.sin(2 * Math.PI * 440 * (i + k) / rate) * 0.5));
	}
	const first = w.take(), rest = w.finish();
	assert.equal(w.take().length, 0); // take() hands bytes over once
	const bytes = Buffer.concat([first, rest]);
	assert.ok(bytes.length > 10_000, `got ${bytes.length} bytes`); // ~16 KB at 128 kbps
	assert.equal(bytes[0], 0xff);
	assert.equal(bytes[1] & 0xe0, 0xe0); // MPEG frame sync
});

/** The header Chromium's MediaRecorder writes (EBML, unknown-size Segment, Info), copied from a real recording. */
const CHROMIUM_WEBM_HEAD = Buffer.from("1a45dfa39f4286810142f7810142f2810442f381084282847765626d42878104428581021853806701ffffffffffffff1549a966992ad7b1830f42404d80864368726f6d655741864368726f6d65", "hex");
const TRACKS = Buffer.from("1654ae6b80", "hex");

void test("addWebmDuration adds an 8-byte Duration to Info and says where it is", () => {
	const head = new Uint8Array(Buffer.concat([CHROMIUM_WEBM_HEAD, TRACKS]));
	const r = addWebmDuration(head)!;
	assert.ok(r);
	assert.equal(r.bytes.length, head.length + 11);
	assert.equal(r.bytes[0x34], 0x80 | (25 + 11)); // Info size grew from 25 to 36
	assert.deepEqual([...r.bytes.subarray(r.slot.offset - 3, r.slot.offset)], [0x44, 0x89, 0x88]);
	assert.equal(r.slot.scale, 1_000_000);
	assert.deepEqual(Buffer.from(r.bytes.subarray(r.slot.offset + 8)), TRACKS); // everything after Info is untouched
	// A header that already has one is left alone and its slot reused.
	const again = addWebmDuration(r.bytes)!;
	assert.equal(again.bytes, r.bytes);
	assert.deepEqual(again.slot, r.slot);
});

void test("addWebmDuration gives up on anything that isn't a MediaRecorder WebM header", () => {
	assert.equal(addWebmDuration(new Uint8Array(Buffer.from("00000024667479706973", "hex"))), null); // MP4
	assert.equal(addWebmDuration(new Uint8Array(CHROMIUM_WEBM_HEAD.subarray(0, 60))), null); // cut inside Info
	const known = Buffer.from(CHROMIUM_WEBM_HEAD);
	known.set([0x01, 0, 0, 0, 0, 0, 0, 0x40], 0x2c); // Segment with a known size: growing Info would break it
	assert.equal(addWebmDuration(new Uint8Array(known)), null);
});

void test("webmDuration is milliseconds in timecode-scale units, float64 big-endian", () => {
	assert.equal(Buffer.from(webmDuration(5000, 1_000_000)).readDoubleBE(0), 5000);
	assert.equal(Buffer.from(webmDuration(5000, 1_000)).readDoubleBE(0), 5_000_000);
});
