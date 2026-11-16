import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameParser, errText, fileName, formatElapsed, getRemote, helperName, joinPath, pickMimeType, scaleRect, videoBitrate } from "./util.ts";

test("T-2 getRemote throws a clear error without electron.remote", () => {
	assert.throws(() => getRemote(() => ({})), /desktop Obsidian/);
	assert.throws(() => getRemote(() => { throw new Error("no require"); }), /desktop Obsidian/);
	const remote = { desktopCapturer: {}, session: {} };
	assert.equal(getRemote(() => ({ remote })), remote);
});

test("T-5 scaleRect maps preview pixels to source pixels", () => {
	const r = scaleRect({ x: 100, y: 50, w: 200, h: 100 }, { w: 400, h: 225 }, { w: 1920, h: 1080 });
	assert.deepEqual(r, { x: 480, y: 240, w: 960, h: 480 });
});

test("T-6 scaleRect normalises reversed drags and clamps to the source", () => {
	const r = scaleRect({ x: 400, y: 225, w: -100, h: -50 }, { w: 400, h: 225 }, { w: 1920, h: 1080 });
	assert.deepEqual(r, { x: 1440, y: 840, w: 480, h: 240 });
	const c = scaleRect({ x: -50, y: 200, w: 600, h: 100 }, { w: 400, h: 225 }, { w: 1920, h: 1080 });
	assert.deepEqual(c, { x: 0, y: 960, w: 1920, h: 120 });
});

test("T-7 scaleRect rounds size down to even numbers", () => {
	const r = scaleRect({ x: 0, y: 0, w: 101, h: 51 }, { w: 1000, h: 1000 }, { w: 1000, h: 1000 });
	assert.deepEqual(r, { x: 0, y: 0, w: 100, h: 50 });
});

test("T-8 scaleRect returns null for a click or a tiny drag", () => {
	assert.equal(scaleRect({ x: 10, y: 10, w: 0, h: 0 }, { w: 400, h: 225 }, { w: 1920, h: 1080 }), null);
	assert.equal(scaleRect({ x: 10, y: 10, w: 1, h: 30 }, { w: 400, h: 225 }, { w: 1920, h: 1080 }), null);
});

test("T-12 fileName uses local time, zero-padded", () => {
	assert.equal(fileName(new Date(2026, 0, 2, 3, 4, 5)), "cap-20260102-030405.webm");
});

test("T-13/T-14 pickMimeType prefers AV1, then VP9, VP8, then default; adds Opus with audio", () => {
	assert.equal(pickMimeType(() => true, false), "video/webm;codecs=av01");
	assert.equal(pickMimeType(() => true, true), "video/webm;codecs=av01,opus");
	assert.equal(pickMimeType((t) => t === "video/webm;codecs=vp8,opus", true), "video/webm;codecs=vp8,opus");
	assert.equal(pickMimeType(() => false, true), "");
});

test("T-15 joinPath trims slashes and handles an empty folder", () => {
	assert.equal(joinPath("Recordings/", "x.webm"), "Recordings/x.webm");
	assert.equal(joinPath(" /a/b/ ", "x.webm"), "a/b/x.webm");
	assert.equal(joinPath("", "x.webm"), "x.webm");
});

test("T-21 formatElapsed shows mm:ss", () => {
	assert.equal(formatElapsed(65_000), "01:05");
	assert.equal(formatElapsed(0), "00:00");
});

test("errText handles Error objects and remote string rejections", () => {
	assert.equal(errText(new Error("boom")), "boom");
	assert.equal(errText("Failed to get sources."), "Failed to get sources.");
});

test("T-22 videoBitrate: medium quality, clamped", () => {
	assert.equal(videoBitrate({ w: 1920, h: 1080 }, 30), 1_555_200);
	assert.equal(videoBitrate({ w: 320, h: 240 }, 30), 250_000);
	assert.equal(videoBitrate({ w: 3840, h: 2160 }, 60), 2_500_000);
});

test("T-23 helperName per platform", () => {
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

test("T-24 FrameParser reassembles frames split at any byte", () => {
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

test("T-25 FrameParser rejects a corrupt header", () => {
	assert.throws(() => new FrameParser().push(frameBytes(2, 2, 9, 0)), /bad frame header/);
});
