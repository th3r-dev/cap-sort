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
| T-10 | FR-5  | Cursor off on macOS | manual | No cursor in frames |
| T-11 | FR-5  | Track reports a cursor value other than the one asked for | unit | `cursorMismatch('never', 'always')` is true; `('never', undefined)` is false |
| T-12 | FR-6  | Date 2026-01-02 03:04:05 | unit | `cap-20260102-030405.webm` |
| T-13 | FR-6  | Only VP8 supported | unit | Picks `video/webm;codecs=vp8` |
| T-14 | FR-6  | Nothing supported | unit | Returns `''` (browser default) |
| T-15 | FR-6  | Folder `Recordings/`, ` /a/b/ `, or empty | unit | `Recordings/x.webm`, `a/b/x.webm`, `x.webm` |
| T-16 | FR-7  | Markdown note open, embed on | manual | `![[Recordings/cap-….webm]]` inserted at the cursor |
| T-17 | FR-7  | No note open | manual | File saved, notice shown, nothing inserted |
| T-18 | FR-8  | Click the status-bar timer | manual | Recording stops and saves; timer goes away |
| T-19 | FR-9  | Close the recorded window mid-recording | manual | Recording stops and saves on its own |
| T-20 | NFR-3 | Open a saved file in Obsidian | manual | Shows duration; scrubbing works; `ffprobe` shows a duration |
| T-21 | FR-8  | 65 s elapsed | unit | `formatElapsed(65000)` → `01:05` |
