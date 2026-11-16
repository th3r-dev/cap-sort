import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, normalizePath } from "obsidian";
import { cropTrack, openStream, record, type Recording } from "./capture.ts";
import { PickerModal, type Choice } from "./picker.ts";
import { errText, fileName, formatElapsed, getRemote, joinPath } from "./util.ts";

interface Settings { folder: string; showCursor: boolean; fps: number; embed: boolean }
const DEFAULTS: Settings = { folder: "Recordings", showCursor: true, fps: 30, embed: true };

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
		new PickerModal(this.app, remote, this.cfg.showCursor, (c) => this.start(remote, c).catch((e) => {
			this.cleanup();
			new Notice(`Recording failed: ${errText(e)}`);
		})).open();
	}

	private async start(remote: any, c: Choice) {
		const { stream, cursorOk } = await openStream(remote, c.source, c.showCursor, this.cfg.fps);
		if (!cursorOk) new Notice("This OS ignored the cursor setting, so the cursor will be recorded.");
		const src = stream.getVideoTracks()[0];
		const track = c.rect && c.preview ? cropTrack(src, c.rect, c.preview) : src;
		this.rec = record(track);
		src.addEventListener("ended", () => { if (this.rec) void this.stop(); }, { once: true }); // window closed, display unplugged

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
		new Setting(el).setName("Frame rate")
			.addDropdown((d) => d.addOptions({ "15": "15 fps", "30": "30 fps", "60": "60 fps" }).setValue(String(s.fps)).onChange((v) => { s.fps = Number(v); void save(); }));
		new Setting(el).setName("Embed in active note").setDesc("Insert ![[recording]] at the cursor when you stop.")
			.addToggle((t) => t.setValue(s.embed).onChange((v) => { s.embed = v; void save(); }));
	}
}
