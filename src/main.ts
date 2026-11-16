import { App, FileSystemAdapter, MarkdownView, Notice, Plugin, PluginSettingTab, normalizePath, requestUrl, type SettingDefinitionItem } from "obsidian";
import { openCapture, record, type Recording } from "./capture.ts";
import { electronRemote, fs } from "./node.ts";
import { LINKS, PickerModal, iconLink, type Choice, type Helper } from "./picker.ts";
import { errText, fileName, formatElapsed, helperName, joinPath, type Remote } from "./util.ts";

export interface Settings { folder: string; showCursor: boolean; mic: boolean; systemAudio: boolean; fps: number; embed: boolean }
const DEFAULTS: Settings = { folder: "Recordings", showCursor: true, mic: true, systemAudio: true, fps: 30, embed: true };

/** Release that holds the prebuilt cursor helpers (built by .github/workflows/helper.yml). */
const HELPER_RELEASE = "https://github.com/th3r-dev/cap-sort/releases/download/helper-v0.1.0";

export default class CapSort extends Plugin {
	declare settings: Settings;
	private rec?: Recording;
	private statusEl?: HTMLElement;
	private timer?: number;
	private ribbon!: HTMLElement;

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
		this.rec = record(cap, this.settings.fps);
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
		const tick = () => time.setText(`REC ${formatElapsed(Date.now() - t0)}`);
		tick();
		this.timer = window.setInterval(tick, 1000);
	}

	private async stop() {
		const rec = this.rec;
		if (!rec) return;
		this.cleanup();
		try {
			const blob = await rec.stop();
			const path = await this.save(blob);
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (this.settings.embed && view) view.editor.replaceSelection(`![[${path}]]\n`);
			new Notice(`Saved ${path}`);
		} catch (e) {
			new Notice(`Couldn't save recording: ${errText(e)}`);
		}
	}

	private async save(blob: Blob): Promise<string> {
		const folder = normalizePath(this.settings.folder || "/");
		if (folder !== "/" && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
		const path = normalizePath(joinPath(this.settings.folder, fileName(new Date())));
		await this.app.vault.createBinary(path, await blob.arrayBuffer());
		return path;
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
