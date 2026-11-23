import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DataAdapter } from "obsidian";
import { TempRecording, recover, type Patch } from "./store.ts";

/** The DataAdapter calls store.ts makes, on a real folder, so renames and appends behave like Obsidian's. */
function vault() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "cap-sort-"));
	const abs = (p: string) => path.join(root, p);
	const adapter = {
		exists: async (p: string) => fs.existsSync(abs(p)),
		mkdir: async (p: string) => { fs.mkdirSync(abs(p), { recursive: true }); },
		write: async (p: string, d: string) => fs.writeFileSync(abs(p), d),
		read: async (p: string) => fs.readFileSync(abs(p), "utf8"),
		appendBinary: async (p: string, d: ArrayBuffer) => fs.appendFileSync(abs(p), new Uint8Array(d)),
		stat: async (p: string) => { const s = fs.statSync(abs(p), { throwIfNoEntry: false }); return s ? { size: s.size, mtime: s.mtimeMs } : null; },
		list: async (p: string) => {
			const all = fs.readdirSync(abs(p), { withFileTypes: true });
			return { files: all.filter((e) => e.isFile()).map((e) => `${p}/${e.name}`), folders: all.filter((e) => e.isDirectory()).map((e) => `${p}/${e.name}`) };
		},
		rename: async (a: string, b: string) => fs.renameSync(abs(a), abs(b)),
		rmdir: async (p: string) => fs.rmSync(abs(p), { recursive: true }),
	} as unknown as DataAdapter;
	const patch: Patch = async (p, offset, bytes) => {
		const fd = fs.openSync(abs(p), "r+");
		try { fs.writeSync(fd, bytes, 0, bytes.length, offset); } finally { fs.closeSync(fd); }
	};
	return { root, abs, adapter, patch };
}

/** EBML header, unknown-size Segment, Info: as Chromium's MediaRecorder writes it (same bytes as in util.test.ts). */
const CHROMIUM_WEBM_HEAD = Buffer.from("1a45dfa39f4286810142f7810142f2810442f381084282847765626d42878104428581021853806701ffffffffffffff1549a966992ad7b1830f42404d80864368726f6d655741864368726f6d65", "hex");
const TMP = ".obsidian/plugins/cap-sort/tmp";
const settled = () => new Promise((r) => setTimeout(r, 20));
const durationOf = (file: Buffer) => file.readDoubleBE(file.indexOf(Buffer.from([0x44, 0x89, 0x88])) + 3);

void test("stop: WebM chunks land in order, the duration is patched in place, files move into the vault", async () => {
	const v = vault();
	const t = await TempRecording.start(v.adapter, v.patch, TMP, { base: "cap-1", folder: "Recordings", format: "webm", mp3: true, startedAt: 0 });
	t.writeVideo(new Blob([CHROMIUM_WEBM_HEAD, Buffer.from("AAAA")]));
	t.writeVideo(new Blob([Buffer.from("BBBB")]));
	t.writeAudio(new Uint8Array([0xff, 0xfb, 1]));
	t.writeAudio(new Uint8Array([2]));
	const paths = await t.finish(4321);
	assert.deepEqual(paths, ["Recordings/cap-1/cap-1.webm", "Recordings/cap-1/cap-1.mp3"]);
	const video = fs.readFileSync(v.abs(paths[0]));
	assert.equal(video.length, CHROMIUM_WEBM_HEAD.length + 11 + 8);
	assert.ok(video.subarray(-8).equals(Buffer.from("AAAABBBB")));
	assert.equal(durationOf(video), 4321);
	assert.deepEqual([...fs.readFileSync(v.abs(paths[1]))], [0xff, 0xfb, 1, 2]);
	assert.deepEqual(fs.readdirSync(v.abs(TMP)), []); // temp folder gone
});

void test("stop: MP4 is moved as written, with no patch and no MP3 folder", async () => {
	const v = vault();
	const t = await TempRecording.start(v.adapter, v.patch, TMP, { base: "cap-2", folder: "", format: "mp4", mp3: false, startedAt: 0 });
	t.writeVideo(new Blob([Buffer.from("ftyp-moov")]));
	t.writeVideo(new Blob([Buffer.from("-moof-mdat")]));
	assert.deepEqual(await t.finish(1000), ["cap-2.mp4"]);
	assert.equal(fs.readFileSync(v.abs("cap-2.mp4"), "utf8"), "ftyp-moov-moof-mdat");
});

void test("crash: the next launch finishes the file, timing it from the last write", async () => {
	const v = vault();
	const t = await TempRecording.start(v.adapter, v.patch, TMP, { base: "cap-3", folder: "Recordings", format: "webm", mp3: false, startedAt: 1_000_000 });
	t.writeVideo(new Blob([CHROMIUM_WEBM_HEAD, Buffer.from("frames")]));
	await settled(); // the process dies here: no finish()
	const file = v.abs(`${TMP}/cap-3/cap-3.webm`);
	fs.utimesSync(file, new Date(1_000_000 + 7_000), new Date(1_000_000 + 7_000)); // last chunk 7 s in
	assert.deepEqual(await recover(v.adapter, v.patch, TMP), ["Recordings/cap-3.webm"]);
	assert.equal(durationOf(fs.readFileSync(v.abs("Recordings/cap-3.webm"))), 7000);
	assert.deepEqual(await recover(v.adapter, v.patch, TMP), []); // nothing left to recover
});

void test("crash: recovery leaves alone a recording that started after it began", async () => {
	const v = vault();
	await TempRecording.start(v.adapter, v.patch, TMP, { base: "cap-7", folder: "R", format: "mp4", mp3: false, startedAt: 5000 });
	assert.deepEqual(await recover(v.adapter, v.patch, TMP, 5000), []);
	assert.ok(fs.existsSync(v.abs(`${TMP}/cap-7/state.json`))); // still there, not dropped as empty
});

void test("crash: a recording that never got a chunk is dropped; a name that's taken gets a suffix", async () => {
	const v = vault();
	await TempRecording.start(v.adapter, v.patch, TMP, { base: "cap-4", folder: "R", format: "mp4", mp3: false, startedAt: 0 });
	const t = await TempRecording.start(v.adapter, v.patch, TMP, { base: "cap-5", folder: "R", format: "mp4", mp3: false, startedAt: 0 });
	t.writeVideo(new Blob([Buffer.from("x")]));
	await settled();
	fs.mkdirSync(v.abs("R"));
	fs.writeFileSync(v.abs("R/cap-5.mp4"), "someone else's");
	assert.deepEqual(await recover(v.adapter, v.patch, TMP), ["R/cap-5-2.mp4"]);
	assert.equal(fs.readFileSync(v.abs("R/cap-5.mp4"), "utf8"), "someone else's");
	assert.deepEqual(fs.readdirSync(v.abs(TMP)), []);
});

void test("a failed write is reported once and finish() refuses, leaving the files for recovery", async () => {
	const v = vault();
	const t = await TempRecording.start(v.adapter, v.patch, TMP, { base: "cap-6", folder: "R", format: "mp4", mp3: false, startedAt: 0 });
	const errors: unknown[] = [];
	t.onError = (e) => errors.push(e);
	t.writeVideo(new Blob([Buffer.from("ok")]));
	await settled();
	fs.rmSync(v.abs(`${TMP}/cap-6`), { recursive: true }); // folder pulled away mid-recording
	t.writeVideo(new Blob([Buffer.from("lost")]));
	t.writeVideo(new Blob([Buffer.from("lost")]));
	await assert.rejects(t.finish(10));
	assert.equal(errors.length, 1);
});
