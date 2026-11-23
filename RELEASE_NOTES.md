Long recordings, output formats, a live preview and a security policy.

- **Long recordings stay light**: the recording is written to disk every second instead of being held in memory, so memory use stays flat for hours and stopping is instant. Before, a 3-hour recording could run out of memory when you stopped it.
- **Crash-safe**: if Obsidian crashes or is force-closed while recording, the next start finishes the file, moves it to your recordings folder and tells you where. At most the last second or two is lost.
- **MP4 is now the default**: H.264 runs on the hardware encoder and used about a quarter of the CPU AV1 did on 1080p screen content. WebM is still in the format dropdown.

- **MP4 or WebM**, in the picker or in settings.
- **MP3 too**: splits a recording into a silent video and an MP3 of its audio, saved together in a folder named after the recording (`Recordings/cap-…/cap-….mp4` and `cap-….mp3`). Both are embedded in the note.
- **Live preview**: while recording, hover the red timer in the status bar or the ribbon icon to see what is being captured.
- If the encoder fails mid-recording, you now get an error instead of a broken file.
- `SECURITY.md` says how to report a vulnerability privately. Dependabot watches npm, Cargo and Actions, and CI runs `npm audit`.
- Dev dependencies no longer pull in the vulnerable minimatch (GHSA-g3hv-75wg-m249). It was only used by the linter and never shipped in `main.js`.
