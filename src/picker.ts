import { App, Modal, Notice, Platform, setIcon } from "obsidian";
import { listSources, type Source } from "./capture.ts";
import type { Settings } from "./main.ts";
import { FORMATS, errText, type Format, type Rect, type Remote, type Size } from "./util.ts";

export interface Choice { source: Source; showCursor: boolean; mic: boolean; systemAudio: boolean; format: Format; mp3: boolean; rect?: Rect; preview?: Size }
export interface Helper { path: string; exists(): boolean; download(): Promise<void> }
type Tab = "screen" | "window" | "region";

const TABS: [Tab, string, string][] = [["screen", "Screen", "monitor"], ["window", "Window", "app-window"], ["region", "Region", "square-dashed"]];
export const LINKS = { github: "https://github.com/th3r-dev/cap-sort", sponsor: "https://github.com/sponsors/th3r-dev" };

/** Every action gets an icon next to its label, so its purpose reads at a glance. */
export function iconButton(parent: HTMLElement, icon: string, text: string, cls = ""): HTMLButtonElement {
	const b = parent.createEl("button", { cls: `cap-sort-btn ${cls}`.trim() });
	setIcon(b.createSpan("cap-sort-btn-icon"), icon);
	b.createSpan({ cls: "cap-sort-btn-label", text });
	return b;
}

/** Same, but a link that opens in the browser. */
export function iconLink(parent: HTMLElement, icon: string, text: string, href: string, cls = ""): HTMLAnchorElement {
	const a = parent.createEl("a", { cls: `cap-sort-link ${cls}`.trim(), href, attr: { target: "_blank", rel: "noopener" } });
	setIcon(a.createSpan("cap-sort-btn-icon"), icon);
	a.createSpan({ text });
	return a;
}
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
	private helperNote!: HTMLElement;
	private showCursor: boolean;
	private mic: boolean;
	private systemAudio: boolean;
	private format: Format;
	private mp3: boolean;

	constructor(app: App, private remote: Remote, cfg: Settings, private helper: Helper, private onPick: (c: Choice) => void) {
		super(app);
		({ showCursor: this.showCursor, mic: this.mic, systemAudio: this.systemAudio, format: this.format, mp3: this.mp3 } = cfg);
	}

	onOpen() {
		this.titleEl.setText("Record screen");
		this.modalEl.addClass("cap-sort-modal");
		const { contentEl } = this;

		const tabs = contentEl.createDiv({ cls: "cap-sort-tabs", attr: { role: "tablist", "aria-label": "What to record" } });
		for (const [t, label, icon] of TABS) {
			const b = iconButton(tabs, icon, label);
			b.setAttrs({ role: "tab", "aria-label": label });
			b.onclick = () => void this.show(t);
			this.tabEls.set(t, b);
		}

		this.body = contentEl.createDiv({ cls: "cap-sort-body", attr: { role: "tabpanel" } });

		// Icon toggles: the icon itself shows on/off (mic vs mic-off), the label says what it controls.
		const opts = contentEl.createDiv({ cls: "cap-sort-options", attr: { role: "group", "aria-label": "Recording options" } });
		this.toggle(opts, "Cursor", ["mouse-pointer-2", "mouse-pointer-ban"], this.showCursor, (v) => { this.showCursor = v; this.refresh(); });
		this.toggle(opts, "Microphone", ["mic", "mic-off"], this.mic, (v) => (this.mic = v));
		this.toggle(opts, "System audio", ["volume-2", "volume-x"], this.systemAudio, (v) => (this.systemAudio = v));
		this.toggle(opts, "MP3 too", ["file-audio", "file-x"], this.mp3, (v) => (this.mp3 = v));
		const fmt = opts.createEl("select", { cls: "dropdown cap-sort-format", attr: { "aria-label": "Video format" } });
		for (const [value, text] of Object.entries(FORMATS)) fmt.createEl("option", { value, text });
		fmt.value = this.format;
		fmt.onchange = () => (this.format = fmt.value as Format);
		this.helperNote = contentEl.createDiv("cap-sort-helper-note");

		const footer = contentEl.createDiv("cap-sort-footer");
		this.hint = footer.createDiv({ cls: "cap-sort-hint", attr: { "aria-live": "polite" } });
		const bar = footer.createDiv("cap-sort-footer-bar");
		const links = bar.createDiv("cap-sort-links");
		iconLink(links, "github", "GitHub", LINKS.github);
		iconLink(links, "heart", "Sponsor", LINKS.sponsor, "is-sponsor");
		this.recordBtn = iconButton(bar, "circle-dot", "Start recording", "mod-cta cap-sort-record");
		this.recordBtn.onclick = () => {
			if (!this.picked) return;
			this.close();
			this.onPick({ source: this.picked, showCursor: this.showCursor, mic: this.mic, systemAudio: this.systemAudio, format: this.format, mp3: this.mp3, rect: this.rect, preview: this.preview });
		};

		void this.show(this.tab);
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

	private toggle(parent: HTMLElement, label: string, [on, off]: [string, string], value: boolean, onChange: (v: boolean) => void) {
		const b = iconButton(parent, value ? on : off, label, "cap-sort-toggle");
		const paint = () => {
			b.toggleClass("is-on", value);
			b.setAttr("aria-pressed", String(value));
			setIcon(b.querySelector(".cap-sort-btn-icon") as HTMLElement, value ? on : off);
		};
		b.onclick = () => { value = !value; paint(); onChange(value); };
		paint();
	}

	private select(s: Source | undefined) {
		this.picked = s;
		this.rect = this.preview = undefined;
		this.refresh();
	}

	/** One place decides whether Start is allowed and what the footer says. */
	private refresh(regionHint?: string) {
		const needHelper = !this.showCursor && !this.helper.exists();
		this.helperNote.empty();
		if (needHelper) this.helperPrompt();
		const hasRegion = !!this.rect && !!this.preview;
		const ready = !!this.picked && (this.tab !== "region" || hasRegion) && !needHelper;
		this.recordBtn.disabled = !ready;
		if (needHelper) this.hint.setText("Download the helper to record without the cursor.");
		else if (!this.picked) this.hint.setText(HINT[this.tab]);
		else if (this.tab === "region") this.hint.setText(regionHint ?? "Drag over the area to record.");
		else this.hint.setText(`Ready: ${this.picked.name}`);
	}

	/** Chromium always draws the cursor, so hiding it needs the small Rust helper from the GitHub release. */
	private helperPrompt() {
		const row = this.helperNote.createDiv("cap-sort-helper-row");
		row.createSpan({ text: "Hiding the cursor needs the cap-sort helper (about 1 MB, downloaded from GitHub)." });
		const btn = iconButton(row, "download", "Download helper");
		btn.onclick = async () => {
			btn.disabled = true;
			btn.querySelector(".cap-sort-btn-label")!.setText("Downloading…");
			try {
				await this.helper.download();
				new Notice("Helper installed.");
			} catch (e) {
				new Notice(`Couldn't download the helper: ${errText(e)}`);
			}
			this.refresh();
		};
	}

	/** macOS answers "Failed to get sources." with no detail when the permission is off, so say what to do instead. */
	private permissionState() {
		this.hint.setText("Waiting for Screen Recording permission.");
		const box = this.body.createDiv("cap-sort-message");
		box.createEl("p", { cls: "cap-sort-message-title", text: "Obsidian can't see your screen yet" });
		box.createEl("p", { text: "Turn on Obsidian under Screen Recording in System Settings, then quit and reopen Obsidian." });
		const row = box.createDiv("cap-sort-actions");
		iconButton(row, "settings", "Open Screen Recording settings", "mod-cta").onclick = () => void this.remote.shell.openExternal(MAC_PRIVACY);
		iconButton(row, "rotate-ccw", "Try again").onclick = () => void this.show(this.tab);
	}

	private errorState(text: string) {
		this.body.empty();
		const box = this.body.createDiv("cap-sort-message");
		box.createEl("p", { text });
		iconButton(box.createDiv("cap-sort-actions"), "rotate-ccw", "Try again").onclick = () => void this.show(this.tab);
	}

	/** Swap the grid for a big still of the screen and let the user drag a rectangle on it. */
	private regionEditor(s: Source) {
		this.body.empty();
		const back = iconButton(this.body, "arrow-left", "Choose another screen", "cap-sort-back");
		back.onclick = () => void this.show("region");
		this.refresh();

		const wrap = this.body.createDiv("cap-sort-region");
		const img = wrap.createEl("img", { attr: { src: s.thumb, alt: `Still of ${s.name}`, draggable: "false" } });
		const box = wrap.createDiv("cap-sort-rect");
		box.hide();

		let start: { x: number; y: number } | null = null;
		// Position lives in CSS variables; styles.css turns them into left/top/width/height.
		const setBox = (x: number, y: number, w: number, h: number) =>
			box.setCssProps({ "--cap-sort-x": `${x}px`, "--cap-sort-y": `${y}px`, "--cap-sort-w": `${w}px`, "--cap-sort-h": `${h}px` });
		const at = (e: PointerEvent) => {
			const r = img.getBoundingClientRect();
			return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) };
		};
		wrap.onpointerdown = (e) => {
			start = at(e);
			wrap.setPointerCapture(e.pointerId);
			box.show();
			setBox(start.x, start.y, 0, 0);
		};
		wrap.onpointermove = (e) => {
			if (!start) return;
			const p = at(e);
			this.rect = { x: start.x, y: start.y, w: p.x - start.x, h: p.y - start.y };
			setBox(Math.min(start.x, p.x), Math.min(start.y, p.y), Math.abs(this.rect.w), Math.abs(this.rect.h));
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
			if (!ok) this.preview = undefined;
			this.refresh(ok ? `Ready: ${Math.round(Math.abs(this.rect!.w) / img.clientWidth * 100)}% × ${Math.round(Math.abs(this.rect!.h) / img.clientHeight * 100)}% of ${s.name}` : undefined);
		};
	}

	onClose() { this.contentEl.empty(); }
}
