// Pure helpers, kept free of Obsidian/Electron imports so `node --test` can run them.

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

export function fileName(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `cap-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.webm`;
}

/** Smallest files first: AV1 beats VP9 on quality per byte, VP8 is the last resort. Opus when there's audio. */
export function pickMimeType(isSupported: (t: string) => boolean, audio: boolean): string {
	const codecs = ["av01", "vp9", "vp8"].map((v) => `video/webm;codecs=${audio ? `${v},opus` : v}`);
	return [...codecs, "video/webm"].find(isSupported) ?? "";
}

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
