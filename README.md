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
- a lightweight provider transport client in [`electron/providerClient.ts`](./electron/providerClient.ts) for IMAP/SMTP verification and SMTP send
- secure request and navigation policy helpers in [`electron/shellPolicy.ts`](./electron/shellPolicy.ts)
- splash and failure fallback screens in [`electron/loadScreens.ts`](./electron/loadScreens.ts)
- persisted window state in [`electron/windowState.ts`](./electron/windowState.ts)
- a SQLite-backed local mail service in [`electron/mailService.ts`](./electron/mailService.ts)
- an Electron-backed encryption wrapper in [`electron/vault.ts`](./electron/vault.ts)
- a desktop-first React UI in [`src/App.tsx`](./src/App.tsx) with:
  - account overview
  - local account onboarding
  - provider verification and mailbox-status sync
  - persisted draft creation
  - SMTP send for plain-text messages
  - folder navigation
  - inbox thread selection
  - sync queue
  - security posture panel
  - transparency ledger
  - runtime and cross-platform release visibility

## Shell hardening in this repo

- renderer requests are limited to local app content and embedded data
- in-app window creation is denied and external links are handed off explicitly
- session permissions, webviews, display capture, and unmanaged downloads are denied
- the app uses a splash screen and controlled failure page during renderer startup issues
- window state is persisted across launches
- account secrets are encrypted before local persistence when Electron `safeStorage` is available
- HTML mail is blocked from rich rendering and reduced to safe plain text until a sanitizer exists
- IMAP and SMTP credentials can be verified from the main process without exposing them to the renderer
- desktop builds are configured for Linux, Windows, and macOS targets
- shell policy and local data service rules are covered by Node-based tests
- CI and cross-OS release workflows are scaffolded in `.github/workflows`

## Commands

Install dependencies and start the desktop app:

```bash
npm install
npm run dev
```

Validate and build:

```bash
npm run typecheck
npm run test
npm run build
npm run ci
npm run dist
```

## Live Test Flow

1. Start the desktop app with `npm run dev`.
2. Add a real account in the onboarding panel using an IMAP/SMTP mailbox and an app password if your provider requires it.
3. Click `Verify & sync` on that account card to test IMAP login, SMTP auth, and inbox status fetch from the main process.
4. Use the compose panel to save a draft locally or `Send now` to submit a plain-text message over SMTP.
5. Review the transparency ledger and security folder for verification and send results.

## Next implementation steps

1. Replace the current verification/status sync path with full IMAP mailbox fetch, folder sync, and message-body retrieval.
2. Add OAuth/provider-specific auth flows where plain username/password is not sufficient.
3. Replace the current HTML blocking policy with a deliberate sanitizer pipeline and remote-content opt-in rules.
4. Add search indexing, attachment pipeline support, and resilient background sync orchestration.
5. Add signing, notarization, update delivery, and release-channel infrastructure for real production distribution.
