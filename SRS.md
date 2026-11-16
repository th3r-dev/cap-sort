# SRS: cap-sort

## 1. Purpose
cap-sort is a screen recorder that runs inside Obsidian desktop. The open question is whether a community plugin, with nothing else installed, can list the screens and windows on the machine, record one of them (or part of one) with the cursor shown or hidden, and save the result as a WebM file in the vault. Obsidian blocks `getDisplayMedia()` by default (it throws `NotSupportedError`), and its plugin docs say nothing about desktop capture, so this needs proving.

## 2. Scope
In scope:
- Record a whole monitor, a single app window, or a rectangle drawn on a monitor
- Cursor shown or hidden, chosen per recording
- Save WebM into a vault folder and embed it in the active note
- macOS, Windows, Linux (desktop Obsidian only)

Out of scope:
- Audio (system or microphone)
- Pause/resume, trimming, MP4 export
- Mobile Obsidian
- A native (Rust) capture helper. That comes later, if Chromium can't hide the cursor on some OS.

## 3. Background / Prior Art
- Obsidian 1.13.7 runs on Electron 43. Its renderer sets `require('electron').remote` to `@electron/remote` (checked in the app bundle), so plugins can reach main-process modules such as `desktopCapturer` and `session`.
- `desktopCapturer.getSources({ types: ['screen', 'window'] })` lists screens and windows with thumbnails on all three OSes. On Linux under PipeWire it returns a single source and the OS portal does the picking.
- `getDisplayMedia()` only works in Electron after something calls `session.setDisplayMediaRequestHandler`. Obsidian doesn't, which explains the `NotSupportedError` reported on the Obsidian forum. The plugin registers the handler itself and hands back the chosen source.
- The `cursor: 'never'` constraint exists in Chromium's desktop capturer, but platform support has varied over time. The plugin reads `track.getSettings().cursor` back and says so if the OS ignored it.
- `MediaRecorder` WebM has no duration in its header, so players can't seek. `fix-webm-duration` patches the header after recording.
- A region is cropped by drawing the screen video onto a canvas and recording `canvas.captureStream()`. Chromium's Region Capture (`CropTarget`) only works on browser tabs, not screens.

## 4. Functional Requirements
- FR-1: The plugin shall list every capturable screen and window, each with a name and thumbnail, when the user opens the recorder picker.
- FR-2: The plugin shall record the chosen monitor at its native resolution when the user selects a screen and presses Record.
- FR-3: The plugin shall record only the chosen app window when the user selects a window and presses Record.
- FR-4: The plugin shall record only the drawn rectangle, converted from preview pixels to source pixels and clamped to the screen, when the user draws a region on a screen preview and presses Record.
- FR-5: The plugin shall request `cursor: 'never'` when "Show cursor" is off and `cursor: 'always'` when it is on, and shall show a notice if the resulting track reports a different value.
- FR-6: The plugin shall save the recording as `cap-YYYYMMDD-HHmmss.webm` in the configured vault folder (default `Recordings`), creating the folder if missing, using the first MIME type MediaRecorder supports among VP9, VP8, then plain WebM.
- FR-7: The plugin shall insert `![[<path>]]` at the cursor of the active Markdown editor when "Embed in active note" is on and a Markdown note is open.
- FR-8: The plugin shall show a running timer in the status bar while recording, and recording shall stop when the user clicks it or runs "Stop recording".
- FR-9: The plugin shall stop and save the recording if the captured source goes away (the window closes or the monitor is unplugged).

## 5. Non-Functional Requirements
- NFR-1: No external install. The plugin ships as `main.js`, `manifest.json` and `styles.css` only.
- NFR-2: Desktop only (`isDesktopOnly: true`). Without `electron.remote`, the plugin shows a clear notice instead of throwing.
- NFR-3: The saved file has a duration and can be seeked in Obsidian's video player.

## 6. Assumptions
- WebM is the default and only output format (user's choice). MP4 is out of scope.
- 30 fps default, adjustable in settings. Screen recordings rarely need more.
- Region selection happens on a still preview inside a modal, not on a fullscreen overlay. This is the same on every OS and needs no extra windows.
- GitHub Issues is the tracker (repo th3r-dev/cap-sort).
- TypeScript only for this PoC. The Rust `scap` helper waits until Windows/Linux cursor hiding is shown to fail.
- Obsidian's own window shows up in recordings unless the user picks another window or region. Hiding it automatically is left out.

## 7. Success Criteria
On macOS with Obsidian 1.13.x, the plugin records (a) a full screen, (b) one window and (c) a region, each with the cursor on and off, and saves seekable WebM files whose size matches the source (or the crop). `ffprobe` must report the expected width and height and a non-zero duration, and the cursor must be missing from the frames when it was turned off. Windows and Linux pass if the same build runs there. Cursor hiding on those two OSes is reported, not required.
