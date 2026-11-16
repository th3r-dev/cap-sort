import { App, Modal, Notice, Platform, Setting } from "obsidian";
import { listSources, type Source } from "./capture.ts";
import { errText, type Rect, type Size } from "./util.ts";

export interface Choice { source: Source; showCursor: boolean; rect?: Rect; preview?: Size }
type Tab = "screen" | "window" | "region";

const TABS: [Tab, string][] = [["screen", "Screen"], ["window", "Window"], ["region", "Region"]];
const HINT: Record<Tab, string> = {
	screen: "Pick a screen to record.",
	window: "Pick a window to record.",
	region: "Pick a screen, then drag over the area to record.",
};
const MAC_PRIVACY = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

export class PickerModal extends Modal {
	private tab: Tab = "screen";
	private picked?: Source;
	private rect?: Rect;
	private preview?: Size;
	private tabEls = new Map<Tab, HTMLButtonElement>();
	private body!: HTMLElement;
	private hint!: HTMLElement;
	private recordBtn!: HTMLButtonElement;

	constructor(app: App, private remote: any, private showCursor: boolean, private onPick: (c: Choice) => void) {
		super(app);
	}

	onOpen() {
		this.setTitle("Record screen");
		this.modalEl.addClass("cap-sort-modal");
		const { contentEl } = this;

		const tabs = contentEl.createDiv({ cls: "cap-sort-tabs", attr: { role: "tablist", "aria-label": "What to record" } });
		for (const [t, label] of TABS) {
			const b = tabs.createEl("button", { text: label, attr: { role: "tab" } });
			b.onclick = () => this.show(t);
			this.tabEls.set(t, b);
		}

		this.body = contentEl.createDiv({ cls: "cap-sort-body", attr: { role: "tabpanel" } });

		new Setting(contentEl).setName("Show cursor").addToggle((tg) => tg.setValue(this.showCursor).onChange((v) => (this.showCursor = v)));

		const footer = contentEl.createDiv("cap-sort-footer");
		this.hint = footer.createDiv({ cls: "cap-sort-hint", attr: { "aria-live": "polite" } });
		this.recordBtn = footer.createEl("button", { cls: "mod-cta", text: "Start recording" });
		this.recordBtn.onclick = () => {
			if (!this.picked) return;
			this.close();
			this.onPick({ source: this.picked, showCursor: this.showCursor, rect: this.rect, preview: this.preview });
		};

		this.show(this.tab);
	}

	private async show(tab: Tab) {
		this.tab = tab;
		this.tabEls.forEach((b, t) => {
			b.toggleClass("is-active", t === tab);
			b.setAttr("aria-selected", String(t === tab));
		});
		this.select(undefined);
		this.body.empty();

		const kind = tab === "window" ? "window" : "screen";
		if (Platform.isMacOS && this.remote.systemPreferences?.getMediaAccessStatus("screen") === "denied") {
			return this.permissionState();
		}
		this.body.createDiv({ cls: "cap-sort-message", text: `Loading ${kind}s…` });

		let sources: Source[];
		try {
			sources = await listSources(this.remote, kind, tab === "window" ? { width: 400, height: 250 } : { width: 1280, height: 800 });
		} catch (e) {
			if (this.tab === tab) this.errorState(`Couldn't list ${kind}s: ${errText(e)}`);
			return;
		}
		if (this.tab !== tab) return; // switched tabs while loading
		this.body.empty();
		if (!sources.length) return this.errorState(kind === "window" ? "No open windows to record." : "No screens found.");

		const grid = this.body.createDiv("cap-sort-grid");
		for (const s of sources) {
			const card = grid.createEl("button", { cls: "cap-sort-card", attr: { "aria-pressed": "false", title: s.name } });
			const img = card.createEl("img", { attr: { src: s.thumb, alt: "" } });
			if (s.thumb.length < 100) img.addClass("is-blank"); // minimised windows come back without a thumbnail
			card.createSpan({ cls: "cap-sort-name", text: s.name });
			card.onclick = () => {
				grid.querySelectorAll(".cap-sort-card").forEach((c) => { c.removeClass("is-selected"); c.setAttr("aria-pressed", "false"); });
				card.addClass("is-selected");
				card.setAttr("aria-pressed", "true");
				this.select(s);
				if (tab === "region") this.regionEditor(s);
			};
		}
	}

	private select(s: Source | undefined) {
		this.picked = s;
		this.rect = this.preview = undefined;
		const ready = !!s && this.tab !== "region"; // region also needs a drawn rectangle
		this.recordBtn.disabled = !ready;
		this.hint.setText(ready ? `Ready: ${s!.name}` : HINT[this.tab]);
	}

	/** macOS answers "Failed to get sources." with no detail when the permission is off, so say what to do instead. */
	private permissionState() {
		this.hint.setText("Waiting for Screen Recording permission.");
		const box = this.body.createDiv("cap-sort-message");
		box.createEl("p", { cls: "cap-sort-message-title", text: "Obsidian can't see your screen yet" });
		box.createEl("p", { text: "Turn on Obsidian under Screen Recording in System Settings, then quit and reopen Obsidian." });
		const row = box.createDiv("cap-sort-actions");
		row.createEl("button", { cls: "mod-cta", text: "Open Screen Recording settings" }).onclick = () => this.remote.shell.openExternal(MAC_PRIVACY);
		row.createEl("button", { text: "Try again" }).onclick = () => this.show(this.tab);
	}

	private errorState(text: string) {
		this.body.empty();
		const box = this.body.createDiv("cap-sort-message");
		box.createEl("p", { text });
		box.createDiv("cap-sort-actions").createEl("button", { text: "Try again" }).onclick = () => this.show(this.tab);
	}

	/** Swap the grid for a big still of the screen and let the user drag a rectangle on it. */
	private regionEditor(s: Source) {
		this.body.empty();
		const back = this.body.createEl("button", { cls: "cap-sort-back", text: "← Choose another screen" });
		back.onclick = () => this.show("region");
		this.hint.setText("Drag over the area to record.");

		const wrap = this.body.createDiv("cap-sort-region");
		const img = wrap.createEl("img", { attr: { src: s.thumb, alt: `Still of ${s.name}`, draggable: "false" } });
		const box = wrap.createDiv("cap-sort-rect");
		box.hide();

		let start: { x: number; y: number } | null = null;
		const at = (e: PointerEvent) => {
			const r = img.getBoundingClientRect();
			return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) };
		};
		wrap.onpointerdown = (e) => {
			start = at(e);
			wrap.setPointerCapture(e.pointerId);
			box.show();
			box.setCssStyles({ left: `${start.x}px`, top: `${start.y}px`, width: "0", height: "0" });
		};
		wrap.onpointermove = (e) => {
			if (!start) return;
			const p = at(e);
			this.rect = { x: start.x, y: start.y, w: p.x - start.x, h: p.y - start.y };
			box.setCssStyles({
				left: `${Math.min(start.x, p.x)}px`, top: `${Math.min(start.y, p.y)}px`,
				width: `${Math.abs(this.rect.w)}px`, height: `${Math.abs(this.rect.h)}px`,
			});
		};
		wrap.onpointerup = () => {
			start = null;
			this.preview = { w: img.clientWidth, h: img.clientHeight };
			const ok = !!this.rect && Math.abs(this.rect.w) > 4 && Math.abs(this.rect.h) > 4;
			if (!ok) {
				box.hide();
				this.rect = undefined;
				new Notice("Drag to draw a rectangle.");
			}
			this.recordBtn.disabled = !ok;
			this.hint.setText(ok ? `Ready: ${Math.round(Math.abs(this.rect!.w) / img.clientWidth * 100)}% × ${Math.round(Math.abs(this.rect!.h) / img.clientHeight * 100)}% of ${s.name}` : "Drag over the area to record.");
		};
	}

	onClose() { this.contentEl.empty(); }
}
