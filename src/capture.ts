import { childProcess } from "./node.ts";
import { AUDIO_BITRATE, FrameParser, errText, Mp3Writer, pickMimeType, scaleRect, videoBitrate, type Format, type Rect, type Remote, type Size } from "./util.ts";

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
	stop: () => void;
}

// Not in lib.dom yet; Chromium has shipped both since v94.
declare const MediaStreamTrackProcessor: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };
declare const MediaStreamTrackGenerator: new (o: { kind: "video" }) => MediaStreamTrack & { writable: WritableStream<VideoFrame> };

const MAX = { w: 1920, h: 1200 }; // "medium": never encode above 1080p-ish, Retina screens included

export async function listSources(remote: Remote, kind: Source["kind"], thumb: { width: number; height: number }): Promise<Source[]> {
	const list = await remote.desktopCapturer.getSources({ types: [kind], thumbnailSize: thumb, fetchWindowIcons: false });
	return list.map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL(), kind }));
}

export async function openCapture(remote: Remote, src: Source, o: CaptureOptions): Promise<Capture> {
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
		cleanups.push(() => video.stop());

		const audio: MediaStreamTrack[] = [...(display?.getAudioTracks() ?? [])];
		if (o.mic) {
			try {
				const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
				mic.getTracks().forEach((t) => cleanups.push(() => t.stop()));
				audio.push(...mic.getAudioTracks());
			} catch {
				warnings.push("Couldn't open the microphone, so it won't be recorded.");
			}
		}
		const mixed = mixAudio(audio);
		if (mixed) cleanups.push(() => mixed.stop());

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
async function displayMedia(remote: Remote, src: Source, o: CaptureOptions): Promise<MediaStream> {
	const ses = remote.session.defaultSession;
	ses.setDisplayMediaRequestHandler((_req, cb) =>
		cb({ video: { id: src.id, name: src.name }, ...(o.systemAudio ? { audio: "loopback" as const } : {}) }));
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

interface Video { track: MediaStreamTrack; size: Promise<Size>; ended: Promise<void>; stop: () => void }

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
	const { spawn } = childProcess();
	const [kind, id] = src.id.split(":"); // Chromium ids look like "screen:1:0" / "window:21320:0"
	const proc = spawn(bin, ["capture", kind, id, "--fps", String(fps), "--max-width", String(MAX.w)], { stdio: ["pipe", "pipe", "pipe"] });
	const gen = new MediaStreamTrackGenerator({ kind: "video" });
	const writer = gen.writable.getWriter();
	const parser = new FrameParser();
	let stderr = "";
	let gotSize: (s: Size) => void, failed: (e: Error) => void, ended: () => void;
	const size = new Promise<Size>((res, rej) => { gotSize = res; failed = rej; });
	const done = new Promise<void>((r) => (ended = r));

	proc.stdout.on("data", (chunk: Buffer) => {
		for (const f of parser.push(chunk)) {
			gotSize({ w: f.w, h: f.h });
			// ponytail: drops frames when the encoder lags; a bounded queue would smooth bursts if that shows up.
			if ((writer.desiredSize ?? 1) <= 0) continue;
			const frame = new VideoFrame(f.data, { format: f.format, codedWidth: f.w, codedHeight: f.h, timestamp: Math.round(performance.now() * 1000) });
			writer.write(frame).catch(() => {}).finally(() => frame.close());
		}
	});
	proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
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

export interface Recording {
	/** Resolves with the duration in ms once the last chunk has been handed to the sink. */
	stop: () => Promise<number>;
}

/** Where encoded data goes as it's produced. Nothing is kept here, so memory doesn't grow with length. */
export interface Sink { video(chunk: Blob): void; audio(bytes: Uint8Array): void }

/** With `mp3` the audio goes to its own MP3 and the video is recorded silent. */
export async function record(c: Capture, fps: number, o: { format: Format; mp3: boolean }, sink: Sink): Promise<Recording> {
	const audioTrack = c.stream.getAudioTracks()[0] as MediaStreamTrack | undefined;
	const mp3 = o.mp3 && audioTrack ? await mp3Tap(audioTrack, (b) => sink.audio(b)) : null;
	const stream = mp3 ? new MediaStream(c.stream.getVideoTracks()) : c.stream;
	const audio = stream.getAudioTracks().length > 0;
	const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t), audio, o.format);
	if (!mimeType) {
		mp3?.stop();
		throw new Error(`${o.format.toUpperCase()} recording isn't supported by this version of Obsidian. Switch the format to WebM.`);
	}
	const rec = new MediaRecorder(stream, {
		mimeType,
		videoBitsPerSecond: videoBitrate(c.size, fps),
		// Chromium's AAC encoder fails ("Internal Error") below 96 kbps; Opus is fine at 64.
		...(audio ? { audioBitsPerSecond: mimeType.includes("mp4a") ? 128_000 : AUDIO_BITRATE } : {}),
	});
	let failed: unknown;
	rec.onerror = (e) => { failed = e.error ?? e; };
	rec.ondataavailable = (e) => { if (e.data.size) sink.video(e.data); };
	const t0 = Date.now();
	const done = new Promise<number>((resolve, reject) => {
		rec.onstop = () => failed
			? reject(new Error(`the ${o.format.toUpperCase()} encoder stopped: ${errText(failed)}`))
			: resolve(Date.now() - t0);
	});
	// 1 s chunks: a crash loses at most the last second. MP4 comes out fragmented, so a cut-off file still plays.
	rec.start(1000);
	return {
		stop: async () => {
			if (rec.state !== "inactive") rec.stop();
			mp3?.stop();
			c.stop();
			return done;
		},
	};
}

// Runs on the audio thread and hands each 128-frame block (left, right) to the page.
const PCM_WORKLET = `registerProcessor("cap-sort-pcm", class extends AudioWorkletProcessor {
	process([input]) {
		if (input?.length) this.port.postMessage([input[0].slice(), (input[1] ?? input[0]).slice()]);
		return true;
	}
});`;

/** Encodes an audio track to MP3 while it plays, handing the bytes over once a second. */
async function mp3Tap(track: MediaStreamTrack, out: (bytes: Uint8Array) => void): Promise<{ stop(): void }> {
	const ctx = new AudioContext();
	const url = URL.createObjectURL(new Blob([PCM_WORKLET], { type: "text/javascript" }));
	try {
		await ctx.audioWorklet.addModule(url);
	} catch (e) {
		void ctx.close();
		throw e;
	} finally {
		URL.revokeObjectURL(url);
	}
	const src = ctx.createMediaStreamSource(new MediaStream([track]));
	// Two channels, explicit: a mono mic is up-mixed, so the encoder always gets stereo.
	const node = new AudioWorkletNode(ctx, "cap-sort-pcm", { channelCount: 2, channelCountMode: "explicit" });
	const writer = new Mp3Writer(2, ctx.sampleRate);
	node.port.onmessage = (e: MessageEvent<[Float32Array, Float32Array]>) => writer.push(e.data[0], e.data[1]);
	src.connect(node);
	node.connect(ctx.destination); // outputs silence; keeps the node in the rendered graph
	const flush = window.setInterval(() => out(writer.take()), 1000);
	return {
		stop: () => {
			window.clearInterval(flush);
			node.port.onmessage = null;
			src.disconnect();
			node.disconnect();
			void ctx.close();
			out(writer.finish());
		},
	};
}

const even = (v: number) => Math.floor(v / 2) * 2;
