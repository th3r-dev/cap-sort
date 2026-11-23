# Security policy

## Supported versions

Only the latest release of cap-sort gets security fixes. Update through **Settings → Community plugins**, BRAT, or the [latest release](https://github.com/th3r-dev/cap-sort/releases/latest).

## Reporting a vulnerability

Please don't open a public issue. Report it privately instead:

1. Go to the [Security tab](https://github.com/th3r-dev/cap-sort/security) and click **Report a vulnerability**.
2. Say what you found, which version, which OS, and how to reproduce it. A proof of concept helps, but keep it harmless.

You'll get a reply within 7 days. Once the issue is confirmed, we agree on a fix and a disclosure date with you, publish a GitHub Security Advisory with the fix release, and credit you unless you'd rather not be named.

## Scope

In scope:

- The plugin code in this repository (`main.js`, `styles.css`, `manifest.json`).
- The cursor helper (`helper/`): the binary, how the plugin downloads it from this repository's releases, writes it to `.obsidian/plugins/cap-sort/bin/`, and runs it.
- The release and CI workflows in `.github/workflows/`, including the artifact attestations.

Out of scope:

- Bugs in Obsidian, Electron or Chromium themselves. Report those upstream.
- Anything that needs an attacker who can already write to your vault's `.obsidian/plugins/` folder.

## Checking a release

Release files and helper binaries carry GitHub artifact attestations:

```sh
gh attestation verify main.js --repo th3r-dev/cap-sort
```

Dependencies are watched by Dependabot, and CI fails when `npm audit` finds a moderate or worse vulnerability.
