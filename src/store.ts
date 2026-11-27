// Recordings are written to disk while they run, in a folder Obsidian doesn't index
// (.obsidian/plugins/cap-sort/tmp/<name>/), then moved into the vault at stop, or on the next
// launch if Obsidian was closed or crashed mid-recording. Memory stays flat however long it runs.
import type { DataAdapter } from "obsidian";
import { addWebmDuration, errText, outputPaths, webmDuration, type DurationSlot, type Format } from "./util.ts";

export interface TempState { base: string; folder: string; format: Format; mp3: boolean; startedAt: number; duration?: DurationSlot }
/** Overwrites bytes at an offset of a file (vault-relative path). Only used for the 8-byte WebM duration. */
export type Patch = (path: string, offset: number, bytes: Uint8Array) => Promise<void>;

const STATE = "state.json";

export class TempRecording {
	private adapter: DataAdapter;
	private patch: Patch;
	private dir: string;
	private state: TempState;
	private queue: Promise<void> = Promise.resolve();
	private failed: unknown;
	private first = true;
	/** Called once, on the first failed write (disk full, folder removed…). */
	onError?: (e: unknown) => void;

	private constructor(adapter: DataAdapter, patch: Patch, dir: string, state: TempState) {
		this.adapter = adapter;
		this.patch = patch;
		this.dir = dir;
		this.state = state;
	}

	static async start(adapter: DataAdapter, patch: Patch, root: string, state: TempState): Promise<TempRecording> {
		const dir = `${root}/${state.base}`;
		for (const d of [root, dir]) if (!(await adapter.exists(d))) await adapter.mkdir(d);
		await adapter.write(`${dir}/${STATE}`, JSON.stringify(state));
		return new TempRecording(adapter, patch, dir, state);
	}

	/** Chunks are appended in arrival order; a slow disk only lengthens the queue. */
	writeVideo(chunk: Blob) {
		this.enqueue(async () => {
			let bytes: Uint8Array = new Uint8Array(await chunk.arrayBuffer());
			if (this.first && this.state.format === "webm") {
				const fixed = addWebmDuration(bytes);
				if (fixed) {
					bytes = fixed.bytes;
					this.state.duration = fixed.slot;
					await this.adapter.write(`${this.dir}/${STATE}`, JSON.stringify(this.state));
				}
			}
			this.first = false;
			await this.adapter.appendBinary(paths(this.dir, this.state).video, buffer(bytes));
		});
	}

	writeAudio(bytes: Uint8Array) {
		if (bytes.length) this.enqueue(() => this.adapter.appendBinary(paths(this.dir, this.state).audio, buffer(bytes)));
	}

	/** Waits for pending writes, then moves the files into the vault. On failure the files stay for recovery. */
	async finish(durationMs = Date.now() - this.state.startedAt): Promise<string[]> {
		await this.queue;
		if (this.failed) throw this.failed instanceof Error ? this.failed : new Error(errText(this.failed));
		return finalize(this.adapter, this.patch, this.dir, this.state, durationMs);
	}

	/** Recording never started: drop the temp folder. */
	async discard() {
		await this.queue;
		await this.adapter.rmdir(this.dir, true);
	}

	private enqueue(write: () => Promise<void>) {
		this.queue = this.queue.then(write).catch((e: unknown) => {
			if (this.failed) return;
			this.failed = e;
			this.onError?.(e);
		});
	}
}

/**
 * Finishes recordings left in `root` by a crash or force-close. Returns the vault paths it saved.
 * Only touches recordings started before `before`, so one started while this runs is left alone.
 */
export async function recover(adapter: DataAdapter, patch: Patch, root: string, before = Date.now()): Promise<string[]> {
	if (!(await adapter.exists(root))) return [];
	const saved: string[] = [];
	for (const dir of (await adapter.list(root)).folders) {
		try {
			const state = JSON.parse(await adapter.read(`${dir}/${STATE}`)) as TempState;
			if (state.startedAt >= before) continue;
			const stat = await adapter.stat(paths(dir, state).video);
			if (!stat?.size) { await adapter.rmdir(dir, true); continue; } // stopped before the first chunk
			// The last write is the end of the recording, give or take the 1 s chunk that was lost.
			saved.push(...await finalize(adapter, patch, dir, state, stat.mtime - state.startedAt));
		} catch (e) {
			console.error(`cap-sort: couldn't recover ${dir}; it stays there for the next try`, e);
		}
	}
	return saved;
}

async function finalize(adapter: DataAdapter, patch: Patch, dir: string, s: TempState, durationMs: number): Promise<string[]> {
	const src = paths(dir, s);
	if (!(await adapter.exists(src.video))) throw new Error("nothing was recorded");
	if (s.duration) await patch(src.video, s.duration.offset, webmDuration(Math.max(0, durationMs), s.duration.scale));
	const audio = s.mp3 && (await adapter.exists(src.audio));
	// Never overwrite: a recovered recording could share a name with one saved since.
	let out = outputPaths(s.folder, s.base, s.format, audio);
	for (let n = 2; await adapter.exists(out.dir ?? out.video); n++) out = outputPaths(s.folder, `${s.base}-${n}`, s.format, audio);
	for (const d of [s.folder.replace(/^\/+|\/+$/g, ""), out.dir]) if (d && !(await adapter.exists(d))) await adapter.mkdir(d);
	const moves: [string, string][] = [[src.video, out.video], ...(audio && out.audio ? [[src.audio, out.audio] as [string, string]] : [])];
	for (const [from, to] of moves) await adapter.rename(from, to);
	await adapter.rmdir(dir, true);
	return moves.map(([, to]) => to);
}

// With format "mp3" both are the same file: the MP3 is the recording.
const paths = (dir: string, s: TempState) => ({ video: `${dir}/${s.base}.${s.format}`, audio: `${dir}/${s.base}.mp3` });

/** appendBinary wants an ArrayBuffer of exactly these bytes, not a view into a bigger one. */
const buffer = (b: Uint8Array): ArrayBuffer =>
	b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? (b.buffer as ArrayBuffer) : b.slice().buffer;
