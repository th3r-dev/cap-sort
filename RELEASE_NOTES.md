Audio-only recording and a lighter audio path.

- **MP3 (audio only)**: a third format next to MP4 and WebM. It records the microphone and/or system audio straight to `Recordings/cap-….mp3` (128 kbps stereo), with no video encoded. You still pick a screen, because system audio comes through screen capture. With the microphone only, no screen is captured at all.
- With MP3 picked, the Cursor and MP3 too toggles are hidden, and Start stays off until the microphone or system audio is on.
- When there's only one audio source, cap-sort no longer runs an extra audio mixer, and MP3 encoding does less work per sample.
