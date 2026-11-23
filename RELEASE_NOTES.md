Output formats, a live preview and a security policy.

- **MP4**: pick WebM (default, smallest) or MP4 (H.264 + AAC, plays everywhere) in the picker or in settings.
- **MP3 too**: splits a recording into a silent video and an MP3 of its audio, saved together in a folder named after the recording (`Recordings/cap-…/cap-….webm` and `cap-….mp3`). Both are embedded in the note.
- **Live preview**: while recording, hover the red timer in the status bar or the ribbon icon to see what is being captured.
- If the encoder fails mid-recording, you now get an error instead of a broken file.
- `SECURITY.md` says how to report a vulnerability privately. Dependabot watches npm, Cargo and Actions, and CI runs `npm audit`.
- Dev dependencies no longer pull in the vulnerable minimatch (GHSA-g3hv-75wg-m249). It was only used by the linter and never shipped in `main.js`.
