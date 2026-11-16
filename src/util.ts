// Pure helpers, kept free of Obsidian/Electron imports so `node --test` can run them.

export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }

/** Obsidian puts @electron/remote on require("electron").remote; plugins have no other way to reach desktopCapturer. */
export function getRemote(req: (id: string) => any): any {
	let remote;
	try { remote = req("electron")?.remote; } catch { /* not Electron */ }
	if (!remote?.desktopCapturer || !remote?.session) {
		throw new Error("cap-sort needs desktop Obsidian (electron.remote is not available).");
	}
	return remote;
}

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

/** True when the OS reported a cursor mode different from the one requested. */
export function cursorMismatch(wanted: string, got: string | undefined): boolean {
	return got !== undefined && got !== wanted;
}

export function fileName(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `cap-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.webm`;
}

export function pickMimeType(isSupported: (t: string) => boolean): string {
	return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(isSupported) ?? "";
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
