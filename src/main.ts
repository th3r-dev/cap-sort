import { App, FileSystemAdapter, MarkdownView, Notice, Plugin, PluginSettingTab, normalizePath, requestUrl, type SettingDefinitionItem } from "obsidian";
import { openCapture, record, type Recording } from "./capture.ts";
import { electronRemote, fs } from "./node.ts";
import { LINKS, PickerModal, iconLink, type Choice, type Helper } from "./picker.ts";
import { FORMATS, errText, fileName, formatElapsed, helperName, outputPaths, type Format, type Remote } from "./util.ts";

export interface Settings { folder: string; showCursor: boolean; mic: boolean; systemAudio: boolean; fps: number; embed: boolean; format: Format; mp3: boolean }
const DEFAULTS: Settings = { folder: "Recordings", showCursor: true, mic: true, systemAudio: true, fps: 30, embed: true, format: "webm", mp3: false };

/** Release that holds the prebuilt cursor helpers (built by .github/workflows/helper.yml). */
const HELPER_RELEASE = "https://github.com/th3r-dev/cap-sort/releases/download/helper-v0.1.0";

export default class CapSort extends Plugin {
	declare settings: Settings;
	private rec?: Recording;
	private statusEl?: HTMLElement;
	private format: Format = "webm";
	private timer?: number;
	private ribbon!: HTMLElement;
	/** Undoes the hover preview: listeners on the ribbon and status bar, and the popup if it's open. */
	private unpreview: (() => void)[] = [];

	async onload() {
		const saved = (await this.loadData()) as Partial<Settings> | null;
		this.settings = { ...DEFAULTS, ...saved };
		this.addSettingTab(new CapSortSettings(this.app, this));
		this.ribbon = this.addRibbonIcon("video", "Start recording", () => {
			if (this.rec) void this.stop();
			else this.pick();
		});
		this.addCommand({ id: "start", name: "Start recording…", checkCallback: (check) => !this.rec && (check || this.pick(), true) });
		this.addCommand({ id: "stop", name: "Stop recording", checkCallback: (check) => !!this.rec && (check || void this.stop(), true) });
	}

	onunload() {
		if (this.rec) void this.stop();
	}

	private pick() {
		let remote: Remote;
		try { remote = electronRemote(); } catch (e) { new Notice(errText(e)); return; }
		new PickerModal(this.app, remote, this.settings, this.helper(), (c) => {
			this.start(remote, c).catch((e: unknown) => {
				this.cleanup();
				new Notice(`Recording failed: ${errText(e)}`);
			});
		}).open();
	}

	private async start(remote: Remote, c: Choice) {
		const helper = this.helper();
		const cap = await openCapture(remote, c.source, {
			fps: this.settings.fps, mic: c.mic, systemAudio: c.systemAudio, rect: c.rect, preview: c.preview,
			// Chromium always draws the cursor; only the helper can leave it out.
			helper: !c.showCursor && helper.exists() ? helper.path : undefined,
		});
		cap.warnings.forEach((w) => new Notice(w));
		const mp3 = c.mp3 && cap.stream.getAudioTracks().length > 0;
		if (c.mp3 && !mp3) new Notice("No audio to save as MP3: the microphone and system audio are both off.");
		try {
			this.rec = await record(cap, this.settings.fps, { format: c.format, mp3 });
		} catch (e) {
			cap.stop();
			throw e;
		}
		this.format = c.format;
		void cap.ended.then(() => { if (this.rec) void this.stop(); }); // window closed, display unplugged

		const t0 = Date.now();
		this.statusEl = this.addStatusBarItem();
		this.statusEl.addClass("cap-sort-status", "mod-clickable");
		this.statusEl.setAttr("aria-label", "Stop recording");
		this.statusEl.onclick = () => void this.stop();
		this.statusEl.createSpan("cap-sort-dot");
		const time = this.statusEl.createSpan();
		this.ribbon.addClass("cap-sort-recording");
		this.ribbon.setAttr("aria-label", "Stop recording");
		const video = new MediaStream(cap.stream.getVideoTracks()); // no audio, so the preview can't echo
		this.hoverPreview(this.ribbon, video);
		this.hoverPreview(this.statusEl, video);
		const tick = () => time.setText(`REC ${formatElapsed(Date.now() - t0)}`);
		tick();
		this.timer = window.setInterval(tick, 1000);
	}

	private async stop() {
		const rec = this.rec;
		if (!rec) return;
		this.cleanup();
		try {
			const out = await rec.stop();
			const paths = await this.save(out);
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (this.settings.embed && view) view.editor.replaceSelection(paths.map((p) => `![[${p}]]\n`).join(""));
			new Notice(`Saved ${paths.join(" and ")}`);
		} catch (e) {
			new Notice(`Couldn't save recording: ${errText(e)}`);
		}
	}

	private async save(out: { video: Blob; audio?: Blob }): Promise<string[]> {
		const p = outputPaths(this.settings.folder, fileName(new Date()), this.format, !!out.audio);
		for (const dir of [this.settings.folder, p.dir]) {
			const folder = normalizePath(dir || "/");
			if (folder !== "/" && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
		}
		const files: [string, Blob][] = [[p.video, out.video], ...(p.audio && out.audio ? [[p.audio, out.audio] as [string, Blob]] : [])];
		for (const [path, blob] of files) await this.app.vault.createBinary(normalizePath(path), await blob.arrayBuffer());
		return files.map(([path]) => normalizePath(path));
	}

	/** While recording, hovering an action icon shows what is being captured. */
	private hoverPreview(el: HTMLElement, stream: MediaStream) {
		let pop: HTMLElement | undefined;
		const hide = () => { pop?.remove(); pop = undefined; };
		const show = () => {
			hide();
			pop = activeDocument.body.createDiv("cap-sort-preview");
			const video = pop.createEl("video", { attr: { muted: "", autoplay: "", playsinline: "" } });
			video.muted = true;
			video.srcObject = stream;
			pop.createSpan({ cls: "cap-sort-preview-badge", text: "REC" });
			// Right of icons on the left side (ribbon), above icons on the right (status bar).
			const r = el.getBoundingClientRect();
			const left = r.left < window.innerWidth / 2;
			pop.toggleClass("is-above", !left);
			pop.setCssProps(left
				? { "--cap-sort-px": `${r.right + 8}px`, "--cap-sort-py": `${Math.max(8, r.top)}px` }
				: { "--cap-sort-px": `${window.innerWidth - r.right}px`, "--cap-sort-py": `${window.innerHeight - r.top + 8}px` });
		};
		el.addEventListener("mouseenter", show);
		el.addEventListener("mouseleave", hide);
		this.unpreview.push(() => {
			el.removeEventListener("mouseenter", show);
			el.removeEventListener("mouseleave", hide);
			hide();
		});
	}

	/** The cursor helper lives next to main.js in bin/, downloaded on first use. */
	private helper(): Helper {
		const adapter = this.app.vault.adapter as FileSystemAdapter;
		const name = helperName(process.platform, process.arch);
		const dir = `${adapter.getBasePath()}/${this.manifest.dir}/bin`;
		const path = `${dir}/${name}`;
		return {
			path,
			exists: () => fs().existsSync(path),
			download: async () => {
				const res = await requestUrl({ url: `${HELPER_RELEASE}/${name}` });
				fs().mkdirSync(dir, { recursive: true });
				fs().writeFileSync(path, new Uint8Array(res.arrayBuffer), { mode: 0o755 });
			},
		};
	}

	private cleanup() {
		this.rec = undefined;
		this.unpreview.splice(0).forEach((f) => f());
		window.clearInterval(this.timer);
		this.statusEl?.remove();
		this.statusEl = undefined;
		this.ribbon.removeClass("cap-sort-recording");
		this.ribbon.setAttr("aria-label", "Start recording");
	}
}

/** Declarative settings, so they show up in Obsidian's settings search. Values live in plugin.settings. */
class CapSortSettings extends PluginSettingTab {
	constructor(app: App, private plugin: CapSort) { super(app, plugin); }

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: "Folder", desc: "Vault folder for recordings. Created if missing.", control: { type: "text", key: "folder", placeholder: "Recordings", defaultValue: DEFAULTS.folder } },
			{ name: "Show cursor by default", desc: "You can still change it in the picker before each recording.", control: { type: "toggle", key: "showCursor", defaultValue: DEFAULTS.showCursor } },
			{ name: "Record microphone", desc: "On by default. You can change it in the picker too.", control: { type: "toggle", key: "mic", defaultValue: DEFAULTS.mic } },
			{ name: "Record system audio", desc: "Sound from apps. Works on macOS 13+ and Windows.", control: { type: "toggle", key: "systemAudio", defaultValue: DEFAULTS.systemAudio } },
			{ name: "Format", desc: "WebM gives the smallest files. MP4 (H.264) plays everywhere. You can change it in the picker too.", control: { type: "dropdown", key: "format", options: FORMATS, defaultValue: DEFAULTS.format } },
			{ name: "Also save audio as MP3", desc: "Splits each recording into a silent video and an MP3, saved together in a folder named after the recording.", control: { type: "toggle", key: "mp3", defaultValue: DEFAULTS.mp3 } },
			{ name: "Frame rate", control: { type: "dropdown", key: "fps", options: { "15": "15 fps", "30": "30 fps", "60": "60 fps" }, defaultValue: String(DEFAULTS.fps) } },
			{ name: "Embed in active note", desc: "Insert ![[recording]] at the cursor when you stop.", control: { type: "toggle", key: "embed", defaultValue: DEFAULTS.embed } },
			{
				type: "group",
				heading: "Support",
				items: [{
					name: "cap-sort is free and open source",
					desc: "Report bugs on GitHub. Sponsoring keeps it maintained.",
					render: (setting) => {
						setting.controlEl.addClass("cap-sort-links");
						iconLink(setting.controlEl, "github", "GitHub", LINKS.github);
						iconLink(setting.controlEl, "heart", "Sponsor", LINKS.sponsor, "is-sponsor");
					},
				}],
			},
		];
	}

	// The frame-rate dropdown works in strings; settings keep a number.
	getControlValue(key: string): unknown {
		const value = this.plugin.settings[key as keyof Settings];
		return key === "fps" ? String(value) : value;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings as unknown as Record<string, unknown>;
		s[key] = key === "fps" ? Number(value) : key === "folder" ? String(value).trim() : value;
		await this.plugin.saveData(this.plugin.settings);
	}
}
