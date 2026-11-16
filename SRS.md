# SRS: cap-sort

## 1. Purpose
cap-sort is a screen recorder that runs inside Obsidian desktop. The open question is whether a community plugin, with nothing else installed, can list the screens and windows on the machine, record one of them (or part of one) with the cursor shown or hidden, and save the result as a WebM file in the vault. Obsidian blocks `getDisplayMedia()` by default (it throws `NotSupportedError`), and its plugin docs say nothing about desktop capture, so this needs proving.

## 2. Scope
In scope:
- Record a whole monitor, a single app window, or a rectangle drawn on a monitor
- Cursor shown or hidden, chosen per recording
- Microphone and system audio, both on by default
- Small files at medium quality
- Save WebM into a vault folder and embed it in the active note
- macOS, Windows, Linux (desktop Obsidian only)

Out of scope:
- Pause/resume, trimming, MP4 export
- Mobile Obsidian
- Code signing / notarization of the helper binary

## 3. Background / Prior Art
- Obsidian 1.13.7 runs on Electron 43. Its renderer sets `require('electron').remote` to `@electron/remote` (checked in the app bundle), so plugins can reach main-process modules such as `desktopCapturer` and `session`.
- `desktopCapturer.getSources({ types: ['screen', 'window'] })` lists screens and windows with thumbnails on all three OSes. On Linux under PipeWire it returns a single source and the OS portal does the picking.
- `getDisplayMedia()` only works in Electron after something calls `session.setDisplayMediaRequestHandler`. Obsidian doesn't, which explains the `NotSupportedError` reported on the Obsidian forum. The plugin registers the handler itself and hands back the chosen source.
- **Measured:** Chromium 150 (Obsidian 1.15) ignores `cursor: 'never'`. It's missing from `getSupportedConstraints()`, `getSettings().cursor` always reads `"always"`, and with the mouse parked at screen center the pointer shows in both "always" and "never" frames. Hiding the cursor therefore needs a native capturer.
- `scap` (Rust; ScreenCaptureKit on macOS, Windows.Graphics.Capture on Windows, PipeWire on Linux) has a `show_cursor` switch. The helper only streams raw frames; cropping, audio and encoding stay in the plugin. scap 0.1.0-beta.1 can't size other apps' windows on macOS (`NSApp windowWithWindowNumber` only sees its own process), so `helper/vendor/scap` carries a two-function patch.
- System audio comes from Electron's display-media handler (`audio: 'loopback'`), which works on macOS 13+ and Windows. Chromium applies voice processing by default, which mangles music, so it's turned off for system audio.
- MediaRecorder keeps only one audio track, so mic and system audio are mixed with an `AudioContext`.
- **Measured:** at the same bitrate target, AV1 and VP9 produce files of about the same size (MediaRecorder sizes by bitrate), and AV1 gives better quality per byte. Size is controlled by capping resolution and bitrate.
- `MediaRecorder` WebM has no duration in its header, so players can't seek. `fix-webm-duration` patches the header after recording.
- A region is cropped by drawing the screen video onto a canvas and recording `canvas.captureStream()`. Chromium's Region Capture (`CropTarget`) only works on browser tabs, not screens.

## 4. Functional Requirements
- FR-1: The plugin shall list every capturable screen and window, each with a name and thumbnail, when the user opens the recorder picker.
- FR-2: The plugin shall record the chosen monitor at its native resolution when the user selects a screen and presses Record.
- FR-3: The plugin shall record only the chosen app window when the user selects a window and presses Record.
- FR-4: The plugin shall record only the drawn rectangle, converted from preview pixels to source pixels and clamped to the screen, when the user draws a region on a screen preview and presses Record.
- FR-5: The recording shall contain the mouse cursor when "Cursor" is on and shall not contain it when "Cursor" is off. Off is served by the helper. If the helper isn't installed, the picker shall offer to download it and shall not start until it's there.
- FR-6: The plugin shall save the recording as `cap-YYYYMMDD-HHmmss.webm` in the configured vault folder (default `Recordings`), creating the folder if missing, using the first MIME type MediaRecorder supports among AV1, VP9, VP8, then plain WebM (with Opus when there is audio).
- FR-7: The plugin shall insert `![[<path>]]` at the cursor of the active Markdown editor when "Embed in active note" is on and a Markdown note is open.
- FR-8: The plugin shall show a running timer in the status bar while recording, and recording shall stop when the user clicks it or runs "Stop recording".
- FR-9: The plugin shall stop and save the recording if the captured source goes away (the window closes or the monitor is unplugged).
- FR-10: The plugin shall record the microphone and system audio, both on by default and switchable per recording, mixed into one Opus track at 64 kbps. If a source can't be opened, recording continues without it and a notice says so.
- FR-11: The plugin shall encode at most 1920×1200 and target 0.025 bits per pixel per frame (250 kbps to 2.5 Mbps).

## 5. Non-Functional Requirements
- NFR-1: Recording with the cursor shown needs nothing beyond `main.js`, `manifest.json` and `styles.css`. Hiding the cursor downloads one helper binary (≈1 MB) from this repo's GitHub release, only after the user clicks "Download helper".
- NFR-2: Desktop only (`isDesktopOnly: true`). Without `electron.remote`, the plugin shows a clear notice instead of throwing.
- NFR-3: The saved file has a duration and can be seeked in Obsidian's video player.

## 6. Assumptions
- WebM is the default and only output format (user's choice). MP4 is out of scope.
- "Medium quality" means ≤1920×1200 at ~0.025 bits/pixel/frame. That measured 1.0 to 1.3 Mbps (about 7.5 to 9.5 MB per minute) for a busy full screen.
- Chromium screen and window IDs map to scap IDs one to one on macOS (`screen:1:0` ↔ display 1, `window:N:0` ↔ CGWindowID N). Windows and Linux mapping is unverified.
- 30 fps default, adjustable in settings. Screen recordings rarely need more.
- Region selection happens on a still preview inside a modal, not on a fullscreen overlay. This is the same on every OS and needs no extra windows.
- GitHub Issues is the tracker (repo th3r-dev/cap-sort).
- Hiding the cursor uses the Rust helper on every OS, because Chromium ignores the setting everywhere (it isn't even in `getSupportedConstraints()`).
- Obsidian's own window shows up in recordings unless the user picks another window or region. Hiding it automatically is left out.

## 7. Success Criteria
On macOS with Obsidian 1.13.x, the plugin records (a) a full screen, (b) one window and (c) a region, each with the cursor on and off, and saves seekable WebM files whose size matches the source (or the crop). `ffprobe` must report the expected width and height and a non-zero duration, and the cursor must be missing from the frames when it was turned off. The files must also carry an audible Opus track when audio is on. Windows and Linux pass if the same build and the CI-built helper run there.
