import { test } from "node:test";
import assert from "node:assert/strict";
import { cursorMismatch, errText, fileName, formatElapsed, getRemote, joinPath, pickMimeType, scaleRect } from "./util.ts";

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

test("T-11 cursorMismatch only flags a reported, different value", () => {
	assert.equal(cursorMismatch("never", "always"), true);
	assert.equal(cursorMismatch("never", "never"), false);
	assert.equal(cursorMismatch("never", undefined), false);
});

test("T-12 fileName uses local time, zero-padded", () => {
	assert.equal(fileName(new Date(2026, 0, 2, 3, 4, 5)), "cap-20260102-030405.webm");
});

test("T-13/T-14 pickMimeType prefers VP9, then VP8, then default", () => {
	assert.equal(pickMimeType(() => true), "video/webm;codecs=vp9");
	assert.equal(pickMimeType((t) => t === "video/webm;codecs=vp8"), "video/webm;codecs=vp8");
	assert.equal(pickMimeType(() => false), "");
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
