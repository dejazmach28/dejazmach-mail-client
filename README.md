# DejAzmach

DejAzmach is a desktop mail client foundation built with Electron, React, TypeScript, and Vite. The current repo is shaped around three product requirements:

- outstanding desktop UI instead of a browser-tab feeling
- very explicit security posture instead of hidden assumptions
- transparent behavior so trust-relevant actions are visible in the product

## Why Electron

Electron is a suitable fit for this project because the mail and secret-handling boundary can stay in the main process while the renderer remains presentation-only:

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- session permissions denied by default
- in-app window creation and arbitrary navigation denied

Tauri is still a valid alternative, but Electron gives faster leverage for a rich cross-platform desktop workflow while the product surface is still taking shape.

## Current architecture

The foundation is no longer just a single mock screen. It now includes:

- a typed shared IPC contract in [`shared/contracts.ts`](./shared/contracts.ts)
- a preload bridge in [`electron/preload.ts`](./electron/preload.ts) that exposes only `getWorkspaceSnapshot()`
- a hardened Electron shell in [`electron/main.ts`](./electron/main.ts)
- structured desktop mock data in [`electron/workspace.ts`](./electron/workspace.ts)
- a desktop-first React UI in [`src/App.tsx`](./src/App.tsx) with:
  - account overview
  - folder navigation
  - inbox thread selection
  - sync queue
  - security posture panel
  - transparency ledger

## Commands

Install dependencies and start the desktop app:

```bash
npm install
npm run dev
```

Validate and build:

```bash
npm run typecheck
npm run build
npm run dist
```

## Next implementation steps

1. Add a real main-process mail service for IMAP and SMTP so network and protocol code never enters the renderer.
2. Store account credentials in the operating system keychain with `safeStorage` plus a secret-provider layer.
3. Add encrypted local mail cache, search indexing, and offline-first sync orchestration.
4. Add HTML mail sanitization and remote-content opt-in rules before rendering real message bodies.
5. Add tests around preload IPC contracts, navigation hardening, and session permission policy.
