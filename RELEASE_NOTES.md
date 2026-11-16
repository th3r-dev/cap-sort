Fixes from the Obsidian community review. Recording works the same as 0.1.0.

- Settings now show up in Obsidian's settings search (they use the settings API from Obsidian 1.13).
- The code no longer passes untyped values around. Electron and Node access is typed in one place (`src/node.ts`), and every promise is awaited or handled.
- Release files (`main.js`, `manifest.json`, `styles.css`) and the cursor helper come with GitHub artifact attestations. To check one: `gh attestation verify main.js --repo th3r-dev/cap-sort`.
- The README says exactly what the shell and file-system access is for: running and installing the cursor helper, nothing else.
