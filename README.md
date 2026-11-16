<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo-light.svg" alt="cap-sort" width="300" height="64">
  </picture>
</p>

<p align="center">
  <a href="https://th3r-dev.github.io/cap-sort/"><b>Try the interactive demo</b></a> ·
  <a href="https://github.com/th3r-dev/cap-sort/releases">Releases</a> ·
  <a href="https://github.com/sponsors/th3r-dev">Sponsor</a>
</p>

Screen recorder for Obsidian desktop. Record a whole screen, one app window, or a region you draw. Your mic and system audio are recorded too, and the video lands in your vault as a WebM file, embedded in the note you're working on.

The [project site](https://th3r-dev.github.io/cap-sort/) has a working copy of the plugin's interface. Click through a recording there and a side panel explains what the plugin does at each step.

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

## Install

cap-sort needs Obsidian 1.15 or later on macOS, Windows or Linux. It doesn't run on mobile.

### From Community plugins

1. Open **Settings → Community plugins**. If Restricted mode is on, click **Turn on community plugins**.
2. Click **Browse** and search for **cap-sort**.
3. Click **Install**, then **Enable**.

cap-sort has been submitted to the community directory. Until it shows up there, use one of the options below.

### With BRAT

Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, run **BRAT: Add a beta plugin for testing**, and enter `th3r-dev/cap-sort`. BRAT keeps it updated from this repository's releases.

### By hand

Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/th3r-dev/cap-sort/releases/latest) into `<vault>/.obsidian/plugins/cap-sort/`, then enable **cap-sort** under **Settings → Community plugins**.

## Releasing

Feature branches merge into `dev`. A release is a pull request from `dev` into `main`.

1. On `dev`, set the new version (`x.y.z`, no `v`) in `manifest.json` and `package.json`, add it to `versions.json` with the lowest Obsidian version it supports, and update `RELEASE_NOTES.md`.
2. Open a pull request from `dev` into `main`.
3. Merge it.

On every push to `main`, [`.github/workflows/release.yml`](.github/workflows/release.yml) reads the version from `manifest.json`. If that version hasn't been released yet, it checks the three version files agree, runs the tests, builds, and publishes release `x.y.z` with `main.js`, `manifest.json` and `styles.css`, which is what Obsidian installs. A merge that doesn't change the version publishes nothing. The community directory reads `manifest.json` from `main`, so it only sees a version once it's merged. The same merge publishes the cursor helper as release `helper-vX.Y.Z` when the version in `helper/Cargo.toml` is new ([`.github/workflows/helper.yml`](.github/workflows/helper.yml)); the plugin downloads from the release named in `HELPER_RELEASE` in `src/main.ts`, so bump both together.

## Build

```sh
npm install
npm run build   # type-check + bundle main.js
npm test        # unit tests (node --test)

cd helper && cargo build --release   # the cursor helper
```

`helper/vendor/scap` is scap 0.1.0-beta.1 with small fixes, each marked `cap-sort patch`: on macOS it couldn't size windows belonging to other apps, and on Windows it didn't compile against the windows-capture 1.5 it depends on.

## Status

Tested on macOS 27.3 with Obsidian 1.15.1: screen, window and region capture, cursor on and off, with audio. The Windows and Linux helpers are built in CI but haven't been tested by hand yet. See [TEST_PLAN.md](TEST_PLAN.md) and [SRS.md](SRS.md).

## Support

Found a bug? [Open an issue](https://github.com/th3r-dev/cap-sort/issues). If cap-sort saves you time, you can [sponsor its development](https://github.com/sponsors/th3r-dev).

MIT licensed.
