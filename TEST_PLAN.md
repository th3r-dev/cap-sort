# Test plan

Unit tests live in `src/util.test.ts` and run with `npm test` (`node --test`). Everything else needs a real Obsidian window, so it's checked by hand.

## Test Matrix

| Test ID | Requirement | Scenario | Type | Expected Result |
|---------|-------------|----------|------|-----------------|
| T-1  | FR-1  | Open picker on a machine with one or more monitors | manual | Screen tab lists each monitor; Window tab lists open windows, each with a thumbnail |
| T-2  | FR-1, NFR-2 | `electron.remote` missing | unit | `getRemote()` throws an error that says desktop Obsidian is required |
| T-3  | FR-2  | Record main monitor 5 s | manual | `ffprobe` size equals the monitor's pixel size |
| T-4  | FR-3  | Record a Finder/Explorer window 5 s | manual | Video shows only that window |
| T-5  | FR-4  | Preview 400×225, source 1920×1080, rect (100,50,200,100) | unit | Source rect (480,240,960,480) |
| T-6  | FR-4  | Rect dragged past the preview edge or drawn right-to-left | unit | Normalised and clamped inside the source |
| T-7  | FR-4  | Odd sizes after scaling | unit | Width/height rounded down to even numbers (VP8/VP9 need them) |
| T-8  | FR-4  | Zero-size rect (a click, not a drag) | unit | Returns `null` so the whole screen is recorded |
| T-9  | FR-4  | Record a region 5 s | manual | `ffprobe` size equals the scaled rect |
| T-10 | FR-5  | Cursor off, mouse parked at screen centre | manual | No pointer in the centre crop (helper path) |
| T-11 | FR-5  | Cursor off, helper not installed | manual | Download prompt shown, Start disabled with the reason in the footer |
| T-12 | FR-6  | Date 2026-01-02 03:04:05 | unit | `cap-20260102-030405.webm` |
| T-13 | FR-6  | All supported / only VP8 / with audio | unit | `av01` first, then `vp8`; `,opus` appended with audio |
| T-14 | FR-6  | Nothing supported | unit | Returns `''` (browser default) |
| T-15 | FR-6  | Folder `Recordings/`, ` /a/b/ `, or empty | unit | `Recordings/x.webm`, `a/b/x.webm`, `x.webm` |
| T-16 | FR-7  | Markdown note open, embed on | manual | `![[Recordings/cap-….webm]]` inserted at the cursor |
| T-17 | FR-7  | No note open | manual | File saved, notice shown, nothing inserted |
| T-18 | FR-8  | Click the status-bar timer | manual | Recording stops and saves; timer goes away |
| T-19 | FR-9  | Close the recorded window mid-recording | manual | Recording stops and saves on its own |
| T-20 | NFR-3 | Open a saved file in Obsidian | manual | Shows duration; scrubbing works; `ffprobe` shows a duration |
| T-21 | FR-8  | 65 s elapsed | unit | `formatElapsed(65000)` → `01:05` |
| T-22 | FR-11 | 1920×1080@30, tiny, 4K@60 | unit | 1.56 Mbps, floor 250 kbps, cap 2.5 Mbps |
| T-23 | FR-5  | Helper name per OS | unit | `cap-sort-helper-darwin-arm64`, `…-win32-x64.exe` |
| T-24 | FR-5  | Helper frames split at 1, 5, 16, 17 bytes | unit | Parser rebuilds both frames exactly |
| T-25 | FR-5  | Corrupt frame header | unit | Throws `bad frame header` |
| T-26 | FR-10 | Mic + system audio on | manual | `ffprobe` shows an Opus stream with non-silent audio |
| T-27 | FR-5  | Window capture via helper on macOS | manual | Works for another app's window (was SCStream −3812 before the scap patch) |
| T-28 | UI    | Window 520 px wide | manual | Tabs stretch, toggles wrap, Start goes full width, links centred |
| T-29 | #9    | `pickMimeType` for MP4 | unit | H.264 + AAC first, then H.264 + Opus, VP9 + Opus, bare `video/mp4`; "" when none |
| T-30 | #9    | `outputPaths` | unit | Flat file without MP3; `<folder>/<name>/<name>.<ext>` + `.mp3` with it |
| T-31 | #9    | `Mp3Writer` on a 1 s sine | unit | > 10 KB, starts with an MPEG frame sync |
| T-32 | #9    | `record()` in Chromium 151: WebM, MP4, MP4 + MP3, WebM + MP3 | scripted (Playwright) | All decode at ~2.0 s; MP3 starts `ff fb`; video is silent when MP3 is on |
| T-33 | #9    | AAC at 64 kbps | scripted | Chromium's encoder fails with "Internal Error", so MP4 uses 128 kbps and `stop()` rejects on encoder errors |
| T-34 | #9    | Hover the ribbon icon / REC timer while recording | manual | Live preview beside the ribbon, above the timer; gone on leave and after stop |
| T-35 | #9    | Record MP4, and WebM + MP3, in Obsidian | manual | Files play in Obsidian; MP3 split lands in its own folder; both embedded |

## Results on macOS 27.3 / Obsidian 1.15.1 (2026-11-16)

| Scenario | Path | Output |
|---|---|---|
| Screen, cursor on | Chromium | AV1 1920×1200 + Opus, 1.27 Mbps average over 13.7 s |
| Screen, cursor off | helper | AV1 1920×1200 + Opus, no pointer at centre (T-10) |
| Window, cursor on | Chromium | AV1 1918×1162 + Opus |
| Window, cursor off | helper | AV1 1920×1164 + Opus |
| Region 50 %×40 %, cursor on | Chromium + crop | AV1 960×480 + Opus |
| Region 50 %×40 %, cursor off | helper + crop | AV1 960×480 + Opus |

Windows and Linux: not run yet. CI builds the helper there; recording has to be checked by hand.
