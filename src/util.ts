// Pure helpers, kept free of Obsidian/Electron imports so `node --test` can run them.
import { Mp3Encoder } from "@breezystack/lamejs";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }

/** The parts of Electron's main-process API (via @electron/remote) that cap-sort uses, typed. */
export interface DesktopSource { id: string; name: string; thumbnail: { toDataURL: () => string } }
export interface DisplayMediaResponse { video: { id: string; name: string }; audio?: "loopback" }
export type DisplayMediaHandler = (request: unknown, callback: (response: DisplayMediaResponse) => void) => void;
export interface Remote {
	desktopCapturer: {
		getSources: (options: { types: ("screen" | "window")[]; thumbnailSize: { width: number; height: number }; fetchWindowIcons?: boolean }) => Promise<DesktopSource[]>;
	};
	session: { defaultSession: { setDisplayMediaRequestHandler: (handler: DisplayMediaHandler | null) => void } };
	systemPreferences?: { getMediaAccessStatus: (media: "screen" | "microphone" | "camera") => string };
	shell: { openExternal: (url: string) => Promise<void> };
}

/** Obsidian puts @electron/remote on require("electron").remote; plugins have no other way to reach desktopCapturer. */
export function getRemote(req: (id: string) => unknown): Remote {
	let remote: unknown;
	try { remote = (req("electron") as { remote?: unknown } | undefined)?.remote; } catch { /* not Electron */ }
	if (!isRemote(remote)) {
		throw new Error("cap-sort needs desktop Obsidian (electron.remote is not available).");
	}
	return remote;
}

const isRemote = (r: unknown): r is Remote =>
	typeof r === "object" && r !== null && "desktopCapturer" in r && "session" in r && !!r.desktopCapturer && !!r.session;

/** Preview-space drag → source-space crop, normalised, clamped, even-sized. null = too small, record whole screen. */
export function scaleRect(r: Rect, preview: Size, source: Size): Rect | null {
	const sx = source.w / preview.w, sy = source.h / preview.h;
	const x0 = clamp(Math.min(r.x, r.x + r.w) * sx, 0, source.w);
	const y0 = clamp(Math.min(r.y, r.y + r.h) * sy, 0, source.h);
	const x1 = clamp(Math.max(r.x, r.x + r.w) * sx, 0, source.w);
	const y1 = clamp(Math.max(r.y, r.y + r.h) * sy, 0, source.h);
	const x = Math.round(x0), y = Math.round(y0);
	const w = even(x1 - x0), h = even(y1 - y0);
	return w < 16 || h < 16 ? null : { x, y, w, h };
}

/** Base name of a recording, without extension. */
export function fileName(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `cap-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export type Format = "webm" | "mp4";
export const FORMATS: Record<Format, string> = { webm: "WebM", mp4: "MP4" };

/**
 * WebM: smallest files first (AV1 beats VP9 on quality per byte, VP8 last). MP4: H.264 + AAC first, the pair
 * every player opens. "" when nothing fits.
 */
export function pickMimeType(isSupported: (t: string) => boolean, audio: boolean, format: Format = "webm"): string {
	const pairs = format === "mp4"
		? [["avc1", "mp4a.40.2"], ["avc1", "opus"], ["vp9", "opus"]]
		: [["av01", "opus"], ["vp9", "opus"], ["vp8", "opus"]];
	const codecs = pairs.map(([v, a]) => `video/${format};codecs=${audio ? `${v},${a}` : v}`);
	return [...new Set(codecs), `video/${format}`].find(isSupported) ?? "";
}

/** Where a recording goes. With MP3 the video and its audio share a folder named after the recording. */
export function outputPaths(folder: string, base: string, ext: Format, mp3: boolean): { dir?: string; video: string; audio?: string } {
	if (!mp3) return { video: joinPath(folder, `${base}.${ext}`) };
	const dir = joinPath(folder, base);
	return { dir, video: `${dir}/${base}.${ext}`, audio: `${dir}/${base}.mp3` };
}

/** Encodes PCM to MP3 as it records. take() hands over what's encoded so far, so nothing piles up. */
export class Mp3Writer {
	private enc: Mp3Encoder;
	private channels: 1 | 2;
	private chunks: Uint8Array[] = [];
	constructor(channels: 1 | 2, sampleRate: number, kbps = 128) {
		this.channels = channels;
		this.enc = new Mp3Encoder(channels, sampleRate, kbps);
	}

	push(left: Float32Array, right: Float32Array = left) {
		const out = this.channels === 2 ? this.enc.encodeBuffer(toInt16(left), toInt16(right)) : this.enc.encodeBuffer(toInt16(left));
		if (out.length) this.chunks.push(bytes(out));
	}

	take(): Uint8Array {
		const out = concat(this.chunks);
		this.chunks = [];
		return out;
	}

	finish(): Uint8Array {
		const out = this.enc.flush();
		if (out.length) this.chunks.push(bytes(out));
		return this.take();
	}
}

const concat = (parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let i = 0;
	for (const p of parts) { out.set(p, i); i += p.length; }
	return out;
};

// ---- WebM duration -------------------------------------------------------------------------------
// MediaRecorder writes WebM with no Duration, so players can't seek. The file is streamed to disk, so
// instead of rewriting it at the end, the first chunk gets a placeholder Duration and its 8 bytes are
// overwritten in place at stop. Only the header (~75 bytes) is ever parsed.

const ID = { segment: 0x18538067, info: 0x1549a966, timecodeScale: 0x2ad7b1, duration: 0x4489 };

/** EBML variable-length int at `i`: its width, and its value (marker bit kept for IDs, dropped for sizes). */
function vint(b: Uint8Array, i: number, isId: boolean): { w: number; v: number } | null {
	const first = b[i];
	if (first === undefined || first === 0) return null;
	const w = Math.clz32(first) - 23;
	if (i + w > b.length) return null;
	let v = isId ? first : first & (0xff >> w);
	for (let k = 1; k < w; k++) v = v * 256 + b[i + k];
	if (!isId && v >= 2 ** (7 * w) - 1) v = -1; // all ones: unknown size
	return { w, v };
}

/** Where a header puts its Duration: the byte offset of the value and the timecode scale (ns per unit). */
export interface DurationSlot { offset: number; scale: number }

/**
 * Adds a placeholder 8-byte Duration to the Info element of a WebM header (the first chunk from
 * MediaRecorder). Returns the patched bytes and the slot to fill in at stop, or null if the header
 * isn't the shape MediaRecorder writes (then the file is kept as is, just without a duration).
 */
export function addWebmDuration(head: Uint8Array): { bytes: Uint8Array; slot: DurationSlot } | null {
	let i = 0;
	// Top level: skip the EBML header, step into the Segment.
	for (;;) {
		const id = vint(head, i, true), size = id && vint(head, i + id.w, false);
		if (!id || !size) return null;
		if (id.v === ID.segment) { i += id.w + size.w; break; }
		if (size.v < 0) return null;
		i += id.w + size.w + size.v;
	}
	// Segment children: find Info. The Segment must be unknown-size, or growing Info would break it.
	for (;;) {
		const id = vint(head, i, true), size = id && vint(head, i + id.w, false);
		if (!id || !size || size.v < 0) return null;
		if (id.v !== ID.info) { i += id.w + size.w + size.v; continue; }
		const sizeAt = i + id.w, start = sizeAt + size.w, end = start + size.v;
		if (end > head.length) return null;
		let scale = 1_000_000;
		for (let j = start; j < end;) {
			const cid = vint(head, j, true), csize = cid && vint(head, j + cid.w, false);
			if (!cid || !csize || csize.v < 0) return null;
			const at = j + cid.w + csize.w;
			if (cid.v === ID.timecodeScale) scale = head.subarray(at, at + csize.v).reduce((n, x) => n * 256 + x, 0);
			if (cid.v === ID.duration) return csize.v === 8 ? { bytes: head, slot: { offset: at, scale } } : null;
			j = at + csize.v;
		}
		const grown = size.v + 11; // 0x44 0x89, size 0x88, 8-byte float
		if (grown >= 2 ** (7 * size.w) - 1) return null;
		const out = new Uint8Array(head.length + 11);
		out.set(head.subarray(0, end));
		for (let k = size.w - 1, v = grown; k >= 0; k--, v = Math.floor(v / 256)) out[sizeAt + k] = v & 0xff;
		out[sizeAt] |= 0x80 >> (size.w - 1);
		out.set([0x44, 0x89, 0x88], end);
		out.set(webmDuration(0, scale), end + 3);
		out.set(head.subarray(end), end + 11);
		return { bytes: out, slot: { offset: end + 3, scale } };
	}
}

/** The 8 bytes for a Duration of `ms`, in timecode-scale units, big-endian float64. */
export function webmDuration(ms: number, scale: number): Uint8Array {
	const b = new Uint8Array(8);
	new DataView(b.buffer).setFloat64(0, (ms * 1_000_000) / scale);
	return b;
}

/** lamejs hands back a reused Int8Array (its typings say Uint8Array): copy it out as bytes. */
const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength).slice();
const toInt16 = (f: Float32Array) => Int16Array.from(f, (v) => clamp(v, -1, 1) * (v < 0 ? 0x8000 : 0x7fff));

/** "Medium" quality for screen content: 0.025 bits per pixel per frame, kept between 250 kbps and 2.5 Mbps. */
export function videoBitrate(size: Size, fps: number): number {
	return Math.round(clamp(size.w * size.h * fps * 0.025, 250_000, 2_500_000));
}

export const AUDIO_BITRATE = 64_000;

/** Name of the prebuilt helper for this OS/CPU, as published on the GitHub release. */
export function helperName(platform: string, arch: string): string {
	return `cap-sort-helper-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
}

/** Helper stdout format: index = the u32 in the frame header. */
export const PIXEL_FORMATS = ["BGRA", "BGRX", "RGBA", "RGBX"] as const;
export interface RawFrame { w: number; h: number; format: (typeof PIXEL_FORMATS)[number]; data: Uint8Array }

/**
 * Splits the helper's byte stream into frames: 16-byte header [w, h, format, 0] (u32 LE) + w*h*4 bytes.
 * Chunks from a pipe arrive at arbitrary boundaries, so it buffers across push() calls.
 */
export class FrameParser {
	private head = new Uint8Array(16);
	private headLen = 0;
	private body: Uint8Array | null = null;
	private bodyLen = 0;
	private meta!: Omit<RawFrame, "data">;

	push(chunk: Uint8Array): RawFrame[] {
		const out: RawFrame[] = [];
		let i = 0;
		while (i < chunk.length) {
			if (!this.body) {
				const n = Math.min(16 - this.headLen, chunk.length - i);
				this.head.set(chunk.subarray(i, i + n), this.headLen);
				this.headLen += n;
				i += n;
				if (this.headLen < 16) break;
				const v = new DataView(this.head.buffer);
				const w = v.getUint32(0, true), h = v.getUint32(4, true), f = v.getUint32(8, true);
				if (!PIXEL_FORMATS[f] || w * h === 0 || w * h > 8192 * 8192) throw new Error(`bad frame header ${w}x${h} format ${f}`);
				this.meta = { w, h, format: PIXEL_FORMATS[f] };
				this.body = new Uint8Array(w * h * 4);
				this.bodyLen = 0;
				this.headLen = 0;
			}
			const n = Math.min(this.body.length - this.bodyLen, chunk.length - i);
			this.body.set(chunk.subarray(i, i + n), this.bodyLen);
			this.bodyLen += n;
			i += n;
			if (this.bodyLen === this.body.length) {
				out.push({ ...this.meta, data: this.body });
				this.body = null;
			}
		}
		return out;
	}
}

export function joinPath(folder: string, name: string): string {
	const f = folder.trim().replace(/^\/+|\/+$/g, "");
	return f ? `${f}/${name}` : name;
}

export function formatElapsed(ms: number): string {
	const s = Math.floor(ms / 1000);
	return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const even = (v: number) => Math.floor(v / 2) * 2;

/** @electron/remote rejects with plain strings, not Error objects. */
export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
