First release.

- Record a whole screen, one app window, or a region you drag on a screen preview.
- Microphone and system audio are on by default and mixed into one Opus track. System audio needs macOS 13+ or Windows.
- Turning the cursor off uses a small helper program (about 1 MB). It's downloaded from this repository's `helper-v0.1.0` release only when you click **Download helper**.
- Video is capped at 1920×1200 and encoded as AV1 when available (VP9 or VP8 otherwise). A busy full screen measured 7.5 to 9.5 MB per minute.
- Saved to `Recordings/` in your vault and embedded at the cursor in the active note.

Tested on macOS 27.3 with Obsidian 1.15.1. Windows and Linux builds haven't been tested by hand yet.
