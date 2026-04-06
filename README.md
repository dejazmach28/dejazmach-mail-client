# DejAzmach

DejAzmach is a secure-by-default desktop mail client foundation built with Electron, React, TypeScript, and Vite. This scaffold is aimed at three product goals:

- outstanding desktop UI instead of a generic web-app shell
- very visible security posture with explicit guardrails
- transparent behavior so privacy-sensitive actions are inspectable

## Why Electron here

Electron is a pragmatic fit for a mail client when the security boundary is designed correctly:

- mail protocol and secret-handling logic can stay in the main process
- the renderer can remain presentation-only with `contextIsolation` and `sandbox` enabled
- desktop packaging and cross-platform distribution are mature

Tauri is also viable, but it raises the implementation cost earlier if the team wants to move quickly on UI and mail workflow.

## Current foundation

- strict Electron shell with `nodeIntegration: false`
- narrow preload bridge via `window.desktopApi`
- denied in-app navigation and denied `window.open`
- transparency ledger and security posture surfaced in the interface
- responsive desktop-first UI for inbox, thread reading, and trust controls

## Next implementation steps

1. Add a main-process mail service for IMAP/SMTP and keep protocol libraries out of the renderer.
2. Store account credentials in the operating system keychain using `safeStorage` and a keytar-style secret provider.
3. Add account onboarding, local encrypted cache, search, and offline sync.
4. Introduce message rendering sanitization for HTML mail before any remote content opt-in.
5. Add tests around preload IPC contracts and navigation hardening.

## Commands

```bash
npm install
npm run dev
```

Build the app:

```bash
npm run build
npm run dist
```
