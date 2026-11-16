import fixWebmDuration from "fix-webm-duration";
import { cursorMismatch, pickMimeType, scaleRect, type Rect, type Size } from "./util.ts";

export interface Source { id: string; name: string; thumb: string; kind: "screen" | "window" }

// Not in lib.dom yet; Chromium has shipped both since v94.
declare const MediaStreamTrackProcessor: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };
declare const MediaStreamTrackGenerator: new (o: { kind: "video" }) => MediaStreamTrack & { writable: WritableStream<VideoFrame> };

export async function listSources(remote: any, kind: Source["kind"], thumb: { width: number; height: number }): Promise<Source[]> {
	const list = await remote.desktopCapturer.getSources({ types: [kind], thumbnailSize: thumb, fetchWindowIcons: false });
	return list.map((s: any) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL(), kind }));
}

/**
 * Obsidian never registers a display-media handler, so getDisplayMedia() throws NotSupportedError.
 * We register one for the duration of this call and answer with the source the user picked.
 * `cursorOk` is false when the OS ignored the cursor setting.
 */
export async function openStream(remote: any, src: Source, showCursor: boolean, fps: number): Promise<{ stream: MediaStream; cursorOk: boolean }> {
	const ses = remote.session.defaultSession;
	const wanted = showCursor ? "always" : "never";
	ses.setDisplayMediaRequestHandler((_req: unknown, cb: (r: unknown) => void) => cb({ video: { id: src.id, name: src.name } }));
	try {
		const stream = await navigator.mediaDevices.getDisplayMedia({
			video: { cursor: wanted, frameRate: fps } as MediaTrackConstraints,
			audio: false,
		});
		const got = (stream.getVideoTracks()[0].getSettings() as { cursor?: string }).cursor;
		// ponytail: Chromium decides cursor support per OS; a Rust scap helper is the upgrade path where it says no.
		return { stream, cursorOk: !cursorMismatch(wanted, got) };
	} finally {
		ses.setDisplayMediaRequestHandler(null);
	}
}

/** Crop every frame to `rect` (given in preview pixels). Runs on frames, not on rendering, so it keeps going while Obsidian is in the background. */
export function cropTrack(track: MediaStreamTrack, rect: Rect, preview: Size): MediaStreamTrack {
	const gen = new MediaStreamTrackGenerator({ kind: "video" });
	let crop: Rect | null | undefined;
	new MediaStreamTrackProcessor({ track }).readable
		.pipeThrough(new TransformStream<VideoFrame, VideoFrame>({
			transform(frame, out) {
				const vis = frame.visibleRect!;
				crop ??= scaleRect(rect, preview, { w: vis.width, h: vis.height });
				out.enqueue(crop
					? new VideoFrame(frame, { visibleRect: { x: vis.x + even(crop.x), y: vis.y + even(crop.y), width: crop.w, height: crop.h } })
					: frame.clone());
				frame.close();
			},
		}))
		.pipeTo(gen.writable)
		.catch(() => gen.stop());
	return gen;
}

export interface Recording { stop(): Promise<Blob> }

export function record(track: MediaStreamTrack): Recording {
	const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
	const rec = new MediaRecorder(new MediaStream([track]), mimeType ? { mimeType } : {});
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
			track.stop();
			return done;
		},
	};
}

const even = (v: number) => Math.floor(v / 2) * 2;
