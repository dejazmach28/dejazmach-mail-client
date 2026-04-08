# DejAzmach

DejAzmach is a secure open-source desktop mail client built with Electron, React, and TypeScript.

## Features

- IMAP folder sync with real server folders
- Message header sync with 60-second background polling
- On-demand message body fetch
- HTML email rendering with user consent
- Rich text composer powered by TipTap
- Quoted-printable and base64 MIME decoding
- SMTP send with full RFC headers
- Reply and Forward with quoted body
- CC and BCC field support
- Attachments: add, view, and download
- Delete, Archive, Move to folder
- Flag/star messages
- Mark as read/unread
- Mark as spam
- Desktop notifications for new mail
- Email signatures per account
- Encrypted local credential storage via Electron safeStorage
- SQLite local message cache
- Cross-platform packaging: Linux (AppImage, deb), Windows (NSIS installer), macOS (DMG, ZIP)

## Setup

Install dependencies:

```bash
npm install
```

Run the app in development:

```bash
npm run dev
```

Build desktop output:

```bash
npm run build
```

Build platform packages locally:

```bash
npx electron-builder --linux --publish never
npx electron-builder --win --publish never
npx electron-builder --mac --publish never
```

## Release Process

GitHub releases are prepared from tags and the manual release workflow.

1. Update the version in [package.json](/home/matthias/Documents/GitHub/dejazmach-mail-client/package.json) if needed.
2. Create and push a tag such as:

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. GitHub Actions will build and publish draft release assets for:
   - Linux: `AppImage`, `deb`
   - Windows: `NSIS` installer
   - macOS: `dmg`, `zip`

The release workflow lives in [.github/workflows/release.yml](/home/matthias/Documents/GitHub/dejazmach-mail-client/.github/workflows/release.yml).

## Signing And Secrets

For production publishing, configure these GitHub repository secrets before shipping signed releases:

- `GITHUB_TOKEN` is provided automatically by GitHub Actions
- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

Unsigned builds can still be produced for testing if signing credentials are not configured.

## Artifacts

Local release artifacts are written to [release](/home/matthias/Documents/GitHub/dejazmach-mail-client/release).

Common files:

- Linux: `DejAzmach-<version>-linux-x86_64.AppImage`, `DejAzmach-<version>-linux-amd64.deb`
- Windows: `DejAzmach-<version>-win-x64.exe`
- macOS: `DejAzmach-<version>-mac-*.dmg`, `DejAzmach-<version>-mac-*.zip`

## Tech Stack

- Electron 35
- React 18
- TypeScript 5
- Vite
- TipTap
- DOMPurify
- SQLite via `node:sqlite`
- Custom IMAP/SMTP transport over `node:tls`

## Known Limitations

- No HTML email sandbox (`webview`) isolation yet
- No OAuth or provider-specific app-password onboarding for Gmail/Outlook
- The rich text composer is HTML-based, but there is no full template/designer system yet
- No full-text search index
- No multi-identity send-from per account
- Linux AppImage still depends on sandbox behavior of the host environment
- macOS notarization still requires Apple credentials and release signing setup

## Development Validation

The main local verification commands are:

```bash
npm run typecheck
npm run ci
```
