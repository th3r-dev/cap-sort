# cap-sort

Screen recorder for Obsidian desktop. Record a whole screen, one app window, or a region you draw. Your mic and system audio are recorded too, and the video lands in your vault as a WebM file, embedded in the note you're working on.

## What it does

- Pick a screen or window from thumbnails. For a region, pick a screen and drag a rectangle over its preview.
- Record with the cursor or without it. Leaving it out needs a small helper program (see below).
- Microphone and system audio are both on by default and mixed into one track. System audio works on macOS 13+ and Windows; on Linux only the mic is recorded.
- Video is capped at 1920×1200 and encoded with AV1 when available (VP9 or VP8 otherwise), with Opus audio at 64 kbps. A busy full-screen recording comes out at roughly 7.5 to 9.5 MB per minute.
- Files are saved as `Recordings/cap-YYYYMMDD-HHmmss.webm` (the folder is configurable) and inserted as `![[…]]` at your cursor.
- While recording, a red timer sits in the status bar. Click it to stop.

## Use

1. Click the camera icon in the left ribbon, or run **cap-sort: Start recording…** from the command palette.
2. Choose **Screen**, **Window** or **Region**, then pick a source.
3. Set **Cursor**, **Microphone** and **System audio**.
4. Click **Start recording**. To stop, click the red timer in the status bar, click the ribbon icon again, or run **cap-sort: Stop recording**.

### macOS permissions

The first time, macOS asks whether Obsidian may record the screen (and use the mic). If you said no earlier, the picker shows a button that opens **System Settings → Privacy & Security → Screen Recording**. Turn Obsidian on there, then quit and reopen Obsidian.

## The cursor helper

Obsidian runs on Chromium, and Chromium always draws the mouse pointer in screen captures. It ignores the request to leave it out. To record without the cursor, cap-sort uses `cap-sort-helper`, a small Rust program (about 1 MB) built on [scap](https://github.com/helmerapp/scap). It captures frames with the pointer left out and hands them to the plugin, which crops, encodes and saves them exactly like the frames it gets from Chromium.

Network use: the helper isn't bundled. When you turn the cursor off for the first time, the picker offers **Download helper**. Clicking it downloads the binary for your OS from this repository's [GitHub releases](https://github.com/th3r-dev/cap-sort/releases) into `.obsidian/plugins/cap-sort/bin/`. Nothing else is downloaded or sent anywhere, and recordings never leave your vault.

The helper's source is in [`helper/`](helper/), and the release binaries are built by [`.github/workflows/helper.yml`](.github/workflows/helper.yml).

## Install (manual)

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/cap-sort/`, then enable **cap-sort** under **Settings → Community plugins**.

## Build

```sh
npm install
npm run build   # type-check + bundle main.js
npm test        # unit tests (node --test)

cd helper && cargo build --release   # the cursor helper
```

`helper/vendor/scap` is scap 0.1.0-beta.1 with a two-function fix: on macOS it couldn't size windows belonging to other apps, so window capture failed. The changes are marked `cap-sort patch`.

## Status

Tested on macOS 27.3 with Obsidian 1.15.1: screen, window and region capture, cursor on and off, with audio. The Windows and Linux helpers are built in CI but haven't been tested by hand yet. See [TEST_PLAN.md](TEST_PLAN.md) and [SRS.md](SRS.md).

## Support

Found a bug? [Open an issue](https://github.com/th3r-dev/cap-sort/issues). If cap-sort saves you time, you can [sponsor its development](https://github.com/sponsors/th3r-dev).

MIT licensed.
