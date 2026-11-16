import { App, FileSystemAdapter, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, normalizePath, requestUrl } from "obsidian";
import { openCapture, record, type Recording } from "./capture.ts";
import { LINKS, PickerModal, iconLink, type Choice, type Helper } from "./picker.ts";
import { errText, fileName, formatElapsed, getRemote, helperName, joinPath } from "./util.ts";

export interface Settings { folder: string; showCursor: boolean; mic: boolean; systemAudio: boolean; fps: number; embed: boolean }
const DEFAULTS: Settings = { folder: "Recordings", showCursor: true, mic: true, systemAudio: true, fps: 30, embed: true };

/** Release that holds the prebuilt cursor helpers (built by .github/workflows/helper.yml). */
const HELPER_RELEASE = "https://github.com/th3r-dev/cap-sort/releases/download/helper-v0.1.0";

export default class CapSort extends Plugin {
	cfg!: Settings;
	private rec?: Recording;
	private statusEl?: HTMLElement;
	private timer?: number;
	private ribbon!: HTMLElement;

	async onload() {
		this.cfg = { ...DEFAULTS, ...(await this.loadData()) };
		this.addSettingTab(new CapSortSettings(this.app, this));
		this.ribbon = this.addRibbonIcon("video", "Start recording", () => (this.rec ? this.stop() : this.pick()));
		this.addCommand({ id: "start", name: "Start recording…", checkCallback: (check) => !this.rec && (check || this.pick(), true) });
		this.addCommand({ id: "stop", name: "Stop recording", checkCallback: (check) => !!this.rec && (check || this.stop(), true) });
	}

	onunload() {
		if (this.rec) void this.stop();
	}

	private pick() {
		let remote;
		try { remote = getRemote((id) => (window as any).require(id)); } catch (e) { new Notice(errText(e)); return; }
		new PickerModal(this.app, remote, this.cfg, this.helper(), (c) => this.start(remote, c).catch((e) => {
			this.cleanup();
			new Notice(`Recording failed: ${errText(e)}`);
		})).open();
	}

	private async start(remote: any, c: Choice) {
		const helper = this.helper();
		const cap = await openCapture(remote, c.source, {
			fps: this.cfg.fps, mic: c.mic, systemAudio: c.systemAudio, rect: c.rect, preview: c.preview,
			// Chromium always draws the cursor; only the helper can leave it out.
			helper: !c.showCursor && helper.exists() ? helper.path : undefined,
		});
		cap.warnings.forEach((w) => new Notice(w));
		this.rec = record(cap, this.cfg.fps);
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
			if (this.cfg.embed && view) view.editor.replaceSelection(`![[${path}]]\n`);
			new Notice(`Saved ${path}`);
		} catch (e) {
			new Notice(`Couldn't save recording: ${errText(e)}`);
		}
	}

	private async save(blob: Blob): Promise<string> {
		const folder = normalizePath(this.cfg.folder || "/");
		if (folder !== "/" && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
		const path = normalizePath(joinPath(this.cfg.folder, fileName(new Date())));
		await this.app.vault.createBinary(path, await blob.arrayBuffer());
		return path;
	}

	/** The cursor helper lives next to main.js in bin/, downloaded on first use. */
	private helper(): Helper {
		const fs = (window as any).require("fs");
		const adapter = this.app.vault.adapter as FileSystemAdapter;
		const name = helperName(process.platform, process.arch);
		const dir = `${adapter.getBasePath()}/${this.manifest.dir}/bin`;
		const path = `${dir}/${name}`;
		return {
			path,
			exists: () => fs.existsSync(path),
			download: async () => {
				const res = await requestUrl({ url: `${HELPER_RELEASE}/${name}` });
				fs.mkdirSync(dir, { recursive: true });
				fs.writeFileSync(path, new Uint8Array(res.arrayBuffer), { mode: 0o755 });
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

class CapSortSettings extends PluginSettingTab {
	constructor(app: App, private plugin: CapSort) { super(app, plugin); }

	display() {
		const { containerEl: el } = this;
		const s = this.plugin.cfg;
		const save = () => this.plugin.saveData(s);
		el.empty();
		new Setting(el).setName("Folder").setDesc("Vault folder for recordings. Created if missing.")
			.addText((t) => t.setPlaceholder("Recordings").setValue(s.folder).onChange((v) => { s.folder = v.trim(); void save(); }));
		new Setting(el).setName("Show cursor by default").setDesc("You can still change it in the picker before each recording.")
			.addToggle((t) => t.setValue(s.showCursor).onChange((v) => { s.showCursor = v; void save(); }));
		new Setting(el).setName("Record microphone").setDesc("On by default. You can change it in the picker too.")
			.addToggle((t) => t.setValue(s.mic).onChange((v) => { s.mic = v; void save(); }));
		new Setting(el).setName("Record system audio").setDesc("Sound from apps. Works on macOS 13+ and Windows.")
			.addToggle((t) => t.setValue(s.systemAudio).onChange((v) => { s.systemAudio = v; void save(); }));
		new Setting(el).setName("Frame rate")
			.addDropdown((d) => d.addOptions({ "15": "15 fps", "30": "30 fps", "60": "60 fps" }).setValue(String(s.fps)).onChange((v) => { s.fps = Number(v); void save(); }));
		new Setting(el).setName("Embed in active note").setDesc("Insert ![[recording]] at the cursor when you stop.")
			.addToggle((t) => t.setValue(s.embed).onChange((v) => { s.embed = v; void save(); }));

		new Setting(el).setName("Support").setHeading();
		const links = new Setting(el).setName("cap-sort is free and open source").setDesc("Report bugs on GitHub. Sponsoring keeps it maintained.").controlEl;
		links.addClass("cap-sort-links");
		iconLink(links, "github", "GitHub", LINKS.github);
		iconLink(links, "heart", "Sponsor", LINKS.sponsor, "is-sponsor");
	}
}
