# DejAzmach

DejAzmach is a secure open-source desktop mail client built with Electron, React, and TypeScript.

## Features

- IMAP folder sync with real server folders
- Message header sync with 60-second background polling
- On-demand message body fetch
- HTML email rendering with user consent
- Quoted-printable and base64 MIME decoding
- SMTP send with full RFC headers
- Reply and Forward with quoted body
- CC field support
- Attachments: view and download
- Delete, Archive, Move to folder
- Flag/star messages
- Mark as read/unread
- Mark as spam
- Desktop notifications for new mail
- Email signatures per account
- Encrypted local credential storage via Electron safeStorage
- SQLite local message cache
- Cross-platform: Linux (AppImage, deb), Windows (NSIS installer)

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
npm run build && npx electron-builder --linux
```

## Tech Stack

- Electron 35
- React 18
- TypeScript 5
- Vite
- SQLite via `node:sqlite`
- Custom IMAP/SMTP transport over `node:tls`

## Known Limitations

- No HTML email sandbox (`webview`) isolation yet
- No OAuth or provider-specific app-password onboarding for Gmail/Outlook
- No rich text composer, plain text only
- No full-text search index
- No multi-identity send-from per account
- AppImage may require `--no-sandbox` on some Linux configurations
