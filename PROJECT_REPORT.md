# PROJECT REPORT

## 1. PROJECT OVERVIEW

### What this app is

DejAzmach is a cross-platform desktop mail client prototype built on Electron. Its stated goals are:

- desktop-first mail UX rather than a browser-style tab app
- explicit security boundaries between UI and secret-handling code
- transparent reporting of trust-relevant actions such as account verification, persistence, and sending

Target platforms currently configured in `package.json` are:

- Linux: `AppImage`, `deb`
- Windows: `nsis`
- macOS: `dmg`, `zip`

### Electron version and architecture

- Declared Electron dependency in `package.json`: `^35.1.4`
- Local packaging logs observed during this workspace session used Electron `35.7.5`

Architecture:

- Main process: [`electron/main.ts`](./electron/main.ts)
  - Creates windows
  - Configures Electron session policy
  - Registers IPC handlers
  - Boots the mail/data layer
- Renderer: [`src/App.tsx`](./src/App.tsx) and [`src/main.tsx`](./src/main.tsx)
  - React UI
  - Account onboarding form
  - 3-pane workspace shell
  - Compose / settings / reader surfaces
- Preload: [`electron/preload.ts`](./electron/preload.ts)
  - Exposes a narrow `desktopApi` bridge via `contextBridge`
- Shared contract layer: [`shared/contracts.ts`](./shared/contracts.ts)
  - Defines renderer/main IPC data types

### Isolation and integration settings

Main window settings in [`electron/main.ts`](./electron/main.ts):

- `contextIsolation: true`
- `nodeIntegration: false`
- `webviewTag: false`
- `webSecurity: true`
- `sandbox: false`

Splash window settings in [`electron/main.ts`](./electron/main.ts):

- `sandbox: true`
- `contextIsolation: true`
- `nodeIntegration: false`

Important note:

- The main renderer is **not sandboxed** right now (`sandbox: false` in [`electron/main.ts`](./electron/main.ts)). This weakens some of the “sandboxed renderer” claims in the docs and earlier implementation notes.

---

## 2. TECH STACK

### Runtime dependencies from `package.json`

| Package | Version | Use |
| --- | --- | --- |
| `react` | `^18.3.1` | Renderer UI framework |
| `react-dom` | `^18.3.1` | React DOM renderer for the Electron frontend |

### Dev dependencies from `package.json`

| Package | Version | Use |
| --- | --- | --- |
| `@types/node` | `^22.14.1` | TypeScript types for Node.js APIs |
| `@types/react` | `^18.3.12` | TypeScript types for React |
| `@types/react-dom` | `^18.3.1` | TypeScript types for React DOM |
| `@vitejs/plugin-react` | `^4.4.1` | Vite plugin for React fast refresh/build support |
| `concurrently` | `^9.1.2` | Runs renderer, Electron TS compiler, and app boot commands together in dev |
| `cross-env` | `^7.0.3` | Cross-platform environment variable injection for npm scripts |
| `electron` | `^35.1.4` | Desktop application runtime |
| `electron-builder` | `^25.1.8` | Packaging and installer generation |
| `typescript` | `^5.8.3` | TypeScript compiler |
| `vite` | `^5.4.18` | Renderer bundler/dev server |
| `wait-on` | `^8.0.3` | Waits for renderer and Electron build outputs before launching the app in dev |

### Important built-in platform modules in use

These are not `package.json` dependencies, but they matter to the implementation:

- `node:sqlite`
  - Used in [`electron/mailService.ts`](./electron/mailService.ts)
  - Provides local persistence via `DatabaseSync`
  - This is the source of the runtime experimental SQLite warning
- `node:net` and `node:tls`
  - Used in [`electron/providerClient.ts`](./electron/providerClient.ts)
  - The app does **not** use `imap`, `imapflow`, `nodemailer`, or similar third-party libraries
  - IMAP and SMTP are implemented manually over raw sockets

### Frontend framework

- React + TypeScript

### CSS approach

- Plain CSS in [`src/styles.css`](./src/styles.css)
- No Tailwind, no Bootstrap, no component library

### Build / bundler tool

- Renderer: Vite
- Electron/main/preload: TypeScript compiler (`tsc`) using [`tsconfig.node.json`](./tsconfig.node.json)

### Test approach

- Node built-in test runner (`node --test`)
- Tests currently cover utility/backend units, not full end-to-end desktop flows

---

## 3. PROJECT STRUCTURE

### Full file tree

The tree below includes all visible project files in the workspace, including generated build and release artifacts. The `.git/` and `node_modules/` directories exist but their internal contents are not expanded because they are repository metadata and third-party vendor files rather than authored project source.

```text
.codex
.github/workflows/ci.yml
.github/workflows/release.yml
.gitignore
README.md
assets/.gitkeep
build/linux/package-deb.sh
build/linux/postinst.sh
build/linux/postrm.sh
dist-electron/electron/loadScreens.d.ts
dist-electron/electron/loadScreens.js
dist-electron/electron/loadScreens.js.map
dist-electron/electron/mailService.d.ts
dist-electron/electron/mailService.js
dist-electron/electron/mailService.js.map
dist-electron/electron/mailService.test.d.ts
dist-electron/electron/mailService.test.js
dist-electron/electron/mailService.test.js.map
dist-electron/electron/main.d.ts
dist-electron/electron/main.js
dist-electron/electron/main.js.map
dist-electron/electron/preload.d.ts
dist-electron/electron/preload.js
dist-electron/electron/preload.js.map
dist-electron/electron/providerClient.d.ts
dist-electron/electron/providerClient.js
dist-electron/electron/providerClient.js.map
dist-electron/electron/providerClient.test.d.ts
dist-electron/electron/providerClient.test.js
dist-electron/electron/providerClient.test.js.map
dist-electron/electron/shellPolicy.d.ts
dist-electron/electron/shellPolicy.js
dist-electron/electron/shellPolicy.js.map
dist-electron/electron/shellPolicy.test.d.ts
dist-electron/electron/shellPolicy.test.js
dist-electron/electron/shellPolicy.test.js.map
dist-electron/electron/vault.d.ts
dist-electron/electron/vault.js
dist-electron/electron/vault.js.map
dist-electron/electron/windowState.d.ts
dist-electron/electron/windowState.js
dist-electron/electron/windowState.js.map
dist-electron/electron/windowState.test.d.ts
dist-electron/electron/windowState.test.js
dist-electron/electron/windowState.test.js.map
dist-electron/electron/workspace.d.ts
dist-electron/electron/workspace.js
dist-electron/electron/workspace.js.map
dist-electron/shared/contracts.d.ts
dist-electron/shared/contracts.js
dist-electron/shared/contracts.js.map
dist-electron/tsconfig.node.tsbuildinfo
dist-electron/vite.config.d.ts
dist-electron/vite.config.js
dist-electron/vite.config.js.map
dist/assets/index-BcOfQX14.css
dist/assets/index-CL5WRVwU.js
dist/index.html
electron/loadScreens.ts
electron/mailService.test.ts
electron/mailService.ts
electron/main.ts
electron/preload.ts
electron/providerClient.test.ts
electron/providerClient.ts
electron/shellPolicy.test.ts
electron/shellPolicy.ts
electron/vault.ts
electron/windowState.test.ts
electron/windowState.ts
index.html
package-lock.json
package.json
release/DejAzmach-0.1.0-linux-amd64.deb
release/DejAzmach-0.1.0-linux-x86_64.AppImage
release/DejAzmach-0.1.0-win-x64.exe
release/DejAzmach-0.1.0-win-x64.exe.blockmap
release/__appImage-x64/AppRun
release/__appImage-x64/LICENSE.electron.txt
release/__appImage-x64/LICENSES.chromium.html
release/__appImage-x64/chrome-sandbox
release/__appImage-x64/chrome_100_percent.pak
release/__appImage-x64/chrome_200_percent.pak
release/__appImage-x64/chrome_crashpad_handler
release/__appImage-x64/dejazmach-mail-client
release/__appImage-x64/dejazmach-mail-client.desktop
release/__appImage-x64/icudtl.dat
release/__appImage-x64/libEGL.so
release/__appImage-x64/libGLESv2.so
release/__appImage-x64/libffmpeg.so
release/__appImage-x64/libvk_swiftshader.so
release/__appImage-x64/libvulkan.so.1
release/__appImage-x64/locales/af.pak
release/__appImage-x64/locales/am.pak
release/__appImage-x64/locales/ar.pak
release/__appImage-x64/locales/bg.pak
release/__appImage-x64/locales/bn.pak
release/__appImage-x64/locales/ca.pak
release/__appImage-x64/locales/cs.pak
release/__appImage-x64/locales/da.pak
release/__appImage-x64/locales/de.pak
release/__appImage-x64/locales/el.pak
release/__appImage-x64/locales/en-GB.pak
release/__appImage-x64/locales/en-US.pak
release/__appImage-x64/locales/es-419.pak
release/__appImage-x64/locales/es.pak
release/__appImage-x64/locales/et.pak
release/__appImage-x64/locales/fa.pak
release/__appImage-x64/locales/fi.pak
release/__appImage-x64/locales/fil.pak
release/__appImage-x64/locales/fr.pak
release/__appImage-x64/locales/gu.pak
release/__appImage-x64/locales/he.pak
release/__appImage-x64/locales/hi.pak
release/__appImage-x64/locales/hr.pak
release/__appImage-x64/locales/hu.pak
release/__appImage-x64/locales/id.pak
release/__appImage-x64/locales/it.pak
release/__appImage-x64/locales/ja.pak
release/__appImage-x64/locales/kn.pak
release/__appImage-x64/locales/ko.pak
release/__appImage-x64/locales/lt.pak
release/__appImage-x64/locales/lv.pak
release/__appImage-x64/locales/ml.pak
release/__appImage-x64/locales/mr.pak
release/__appImage-x64/locales/ms.pak
release/__appImage-x64/locales/nb.pak
release/__appImage-x64/locales/nl.pak
release/__appImage-x64/locales/pl.pak
release/__appImage-x64/locales/pt-BR.pak
release/__appImage-x64/locales/pt-PT.pak
release/__appImage-x64/locales/ro.pak
release/__appImage-x64/locales/ru.pak
release/__appImage-x64/locales/sk.pak
release/__appImage-x64/locales/sl.pak
release/__appImage-x64/locales/sr.pak
release/__appImage-x64/locales/sv.pak
release/__appImage-x64/locales/sw.pak
release/__appImage-x64/locales/ta.pak
release/__appImage-x64/locales/te.pak
release/__appImage-x64/locales/th.pak
release/__appImage-x64/locales/tr.pak
release/__appImage-x64/locales/uk.pak
release/__appImage-x64/locales/ur.pak
release/__appImage-x64/locales/vi.pak
release/__appImage-x64/locales/zh-CN.pak
release/__appImage-x64/locales/zh-TW.pak
release/__appImage-x64/resources.pak
release/__appImage-x64/resources/app.asar
release/__appImage-x64/snapshot_blob.bin
release/__appImage-x64/usr/lib/libXss.so.1
release/__appImage-x64/usr/lib/libXtst.so.6
release/__appImage-x64/usr/lib/libappindicator.so.1
release/__appImage-x64/usr/lib/libgconf-2.so.4
release/__appImage-x64/usr/lib/libindicator.so.7
release/__appImage-x64/usr/lib/libnotify.so.4
release/__appImage-x64/usr/share/icons/hicolor/128x128/apps/dejazmach-mail-client.png
release/__appImage-x64/usr/share/icons/hicolor/16x16/apps/dejazmach-mail-client.png
release/__appImage-x64/usr/share/icons/hicolor/256x256/apps/dejazmach-mail-client.png
release/__appImage-x64/usr/share/icons/hicolor/32x32/apps/dejazmach-mail-client.png
release/__appImage-x64/usr/share/icons/hicolor/48x48/apps/dejazmach-mail-client.png
release/__appImage-x64/usr/share/icons/hicolor/64x64/apps/dejazmach-mail-client.png
release/__appImage-x64/v8_context_snapshot.bin
release/__appImage-x64/vk_swiftshader_icd.json
release/builder-effective-config.yaml
release/linux-unpacked/LICENSE.electron.txt
release/linux-unpacked/LICENSES.chromium.html
release/linux-unpacked/chrome-sandbox
release/linux-unpacked/chrome_100_percent.pak
release/linux-unpacked/chrome_200_percent.pak
release/linux-unpacked/chrome_crashpad_handler
release/linux-unpacked/dejazmach-mail-client
release/linux-unpacked/icudtl.dat
release/linux-unpacked/libEGL.so
release/linux-unpacked/libGLESv2.so
release/linux-unpacked/libffmpeg.so
release/linux-unpacked/libvk_swiftshader.so
release/linux-unpacked/libvulkan.so.1
release/linux-unpacked/locales/af.pak
release/linux-unpacked/locales/am.pak
release/linux-unpacked/locales/ar.pak
release/linux-unpacked/locales/bg.pak
release/linux-unpacked/locales/bn.pak
release/linux-unpacked/locales/ca.pak
release/linux-unpacked/locales/cs.pak
release/linux-unpacked/locales/da.pak
release/linux-unpacked/locales/de.pak
release/linux-unpacked/locales/el.pak
release/linux-unpacked/locales/en-GB.pak
release/linux-unpacked/locales/en-US.pak
release/linux-unpacked/locales/es-419.pak
release/linux-unpacked/locales/es.pak
release/linux-unpacked/locales/et.pak
release/linux-unpacked/locales/fa.pak
release/linux-unpacked/locales/fi.pak
release/linux-unpacked/locales/fil.pak
release/linux-unpacked/locales/fr.pak
release/linux-unpacked/locales/gu.pak
release/linux-unpacked/locales/he.pak
release/linux-unpacked/locales/hi.pak
release/linux-unpacked/locales/hr.pak
release/linux-unpacked/locales/hu.pak
release/linux-unpacked/locales/id.pak
release/linux-unpacked/locales/it.pak
release/linux-unpacked/locales/ja.pak
release/linux-unpacked/locales/kn.pak
release/linux-unpacked/locales/ko.pak
release/linux-unpacked/locales/lt.pak
release/linux-unpacked/locales/lv.pak
release/linux-unpacked/locales/ml.pak
release/linux-unpacked/locales/mr.pak
release/linux-unpacked/locales/ms.pak
release/linux-unpacked/locales/nb.pak
release/linux-unpacked/locales/nl.pak
release/linux-unpacked/locales/pl.pak
release/linux-unpacked/locales/pt-BR.pak
release/linux-unpacked/locales/pt-PT.pak
release/linux-unpacked/locales/ro.pak
release/linux-unpacked/locales/ru.pak
release/linux-unpacked/locales/sk.pak
release/linux-unpacked/locales/sl.pak
release/linux-unpacked/locales/sr.pak
release/linux-unpacked/locales/sv.pak
release/linux-unpacked/locales/sw.pak
release/linux-unpacked/locales/ta.pak
release/linux-unpacked/locales/te.pak
release/linux-unpacked/locales/th.pak
release/linux-unpacked/locales/tr.pak
release/linux-unpacked/locales/uk.pak
release/linux-unpacked/locales/ur.pak
release/linux-unpacked/locales/vi.pak
release/linux-unpacked/locales/zh-CN.pak
release/linux-unpacked/locales/zh-TW.pak
release/linux-unpacked/resources.pak
release/linux-unpacked/resources/app.asar
release/linux-unpacked/snapshot_blob.bin
release/linux-unpacked/v8_context_snapshot.bin
release/linux-unpacked/vk_swiftshader_icd.json
release/win-unpacked/DejAzmach.exe
release/win-unpacked/LICENSE.electron.txt
release/win-unpacked/LICENSES.chromium.html
release/win-unpacked/chrome_100_percent.pak
release/win-unpacked/chrome_200_percent.pak
release/win-unpacked/d3dcompiler_47.dll
release/win-unpacked/ffmpeg.dll
release/win-unpacked/icudtl.dat
release/win-unpacked/libEGL.dll
release/win-unpacked/libGLESv2.dll
release/win-unpacked/locales/af.pak
release/win-unpacked/locales/am.pak
release/win-unpacked/locales/ar.pak
release/win-unpacked/locales/bg.pak
release/win-unpacked/locales/bn.pak
release/win-unpacked/locales/ca.pak
release/win-unpacked/locales/cs.pak
release/win-unpacked/locales/da.pak
release/win-unpacked/locales/de.pak
release/win-unpacked/locales/el.pak
release/win-unpacked/locales/en-GB.pak
release/win-unpacked/locales/en-US.pak
release/win-unpacked/locales/es-419.pak
release/win-unpacked/locales/es.pak
release/win-unpacked/locales/et.pak
release/win-unpacked/locales/fa.pak
release/win-unpacked/locales/fi.pak
release/win-unpacked/locales/fil.pak
release/win-unpacked/locales/fr.pak
release/win-unpacked/locales/gu.pak
release/win-unpacked/locales/he.pak
release/win-unpacked/locales/hi.pak
release/win-unpacked/locales/hr.pak
release/win-unpacked/locales/hu.pak
release/win-unpacked/locales/id.pak
release/win-unpacked/locales/it.pak
release/win-unpacked/locales/ja.pak
release/win-unpacked/locales/kn.pak
release/win-unpacked/locales/ko.pak
release/win-unpacked/locales/lt.pak
release/win-unpacked/locales/lv.pak
release/win-unpacked/locales/ml.pak
release/win-unpacked/locales/mr.pak
release/win-unpacked/locales/ms.pak
release/win-unpacked/locales/nb.pak
release/win-unpacked/locales/nl.pak
release/win-unpacked/locales/pl.pak
release/win-unpacked/locales/pt-BR.pak
release/win-unpacked/locales/pt-PT.pak
release/win-unpacked/locales/ro.pak
release/win-unpacked/locales/ru.pak
release/win-unpacked/locales/sk.pak
release/win-unpacked/locales/sl.pak
release/win-unpacked/locales/sr.pak
release/win-unpacked/locales/sv.pak
release/win-unpacked/locales/sw.pak
release/win-unpacked/locales/ta.pak
release/win-unpacked/locales/te.pak
release/win-unpacked/locales/th.pak
release/win-unpacked/locales/tr.pak
release/win-unpacked/locales/uk.pak
release/win-unpacked/locales/ur.pak
release/win-unpacked/locales/vi.pak
release/win-unpacked/locales/zh-CN.pak
release/win-unpacked/locales/zh-TW.pak
release/win-unpacked/resources.pak
release/win-unpacked/resources/app.asar
release/win-unpacked/snapshot_blob.bin
release/win-unpacked/v8_context_snapshot.bin
release/win-unpacked/vk_swiftshader.dll
release/win-unpacked/vk_swiftshader_icd.json
release/win-unpacked/vulkan-1.dll
shared/contracts.ts
src/App.tsx
src/main.tsx
src/styles.css
src/vite-env.d.ts
tsconfig.json
tsconfig.node.json
vite.config.ts
```

### Major files and what they do

| File | Purpose |
| --- | --- |
| `package.json` | Declares scripts, dependencies, Electron Builder config, and package metadata. |
| `package-lock.json` | Locks dependency versions for reproducible installs. |
| `README.md` | Project documentation and current architectural claims, some of which are now slightly outdated. |
| `index.html` | Vite renderer entry HTML with the renderer mount point. |
| `vite.config.ts` | Configures the renderer build with React plugin and relative `base: "./"` for packaged `file://` loading. |
| `tsconfig.json` | TypeScript config for the renderer/shared frontend code. |
| `tsconfig.node.json` | TypeScript config for Electron main/preload/tests/build-side code. |
| `shared/contracts.ts` | Shared type definitions for accounts, folders, messages, IPC results, and shell state. |
| `src/main.tsx` | Bootstraps the React application into the DOM. |
| `src/App.tsx` | Main renderer component implementing onboarding, workspace shell, compose flow, settings surface, and message reader. |
| `src/styles.css` | Global styling for onboarding and the 3-pane desktop UI. |
| `src/vite-env.d.ts` | Declares `window.desktopApi` for TypeScript. |
| `electron/main.ts` | Main Electron process entry: window creation, session policy, app lifecycle, and IPC handlers. |
| `electron/preload.ts` | Preload bridge exposing typed `ipcRenderer.invoke` wrappers to the renderer. |
| `electron/mailService.ts` | SQLite-backed application service for accounts, folders, messages, drafts, sync logs, and sending/verification orchestration. |
| `electron/providerClient.ts` | Low-level custom IMAP/SMTP socket client built on `node:net`/`node:tls`. |
| `electron/shellPolicy.ts` | Helper functions that decide which navigation and renderer requests are allowed. |
| `electron/loadScreens.ts` | Generates safe inline data-URL splash and load-failure screens. |
| `electron/vault.ts` | Wraps Electron `safeStorage` for local secret encryption/decryption. |
| `electron/windowState.ts` | Persists and restores main window size/position. |
| `electron/mailService.test.ts` | Unit tests for local persistence and draft/account behavior. |
| `electron/providerClient.test.ts` | Unit tests for IMAP/SMTP parsing helpers and plain-text message construction. |
| `electron/shellPolicy.test.ts` | Unit tests for navigation/request policy logic. |
| `electron/windowState.test.ts` | Unit tests for window bounds normalization. |
| `.github/workflows/ci.yml` | GitHub Actions workflow for `npm ci` and `npm run ci`. |
| `.github/workflows/release.yml` | GitHub Actions workflow scaffolding for Linux/Windows/macOS release builds. |
| `build/linux/postinst.sh` | Linux post-install hook to fix `chrome-sandbox` ownership/mode and create launcher symlinks. |
| `build/linux/postrm.sh` | Linux post-remove hook to delete launcher symlinks. |
| `build/linux/package-deb.sh` | Manual Debian packaging fallback script added because the `electron-builder` Debian step hangs in this environment. |
| `assets/.gitkeep` | Placeholder to keep the empty assets directory in git. |
| `dist/**` | Generated renderer build artifacts. |
| `dist-electron/**` | Generated compiled Electron/main/preload/test artifacts. |
| `release/linux-unpacked/**` | Unpacked Linux build payload used for packaging and manual inspection. |
| `release/win-unpacked/**` | Unpacked Windows build payload. |
| `release/__appImage-x64/**` | Intermediate AppImage staging directory produced during packaging. |
| `release/*.deb`, `release/*.AppImage`, `release/*.exe` | Built installer/application artifacts. |

Notable generated artifact drift:

- `dist-electron/electron/workspace.*` exists even though `electron/workspace.ts` is no longer present in source, so the build output contains stale history from an older implementation.

---

## 4. IMPLEMENTED FEATURES

This section distinguishes between “implemented in code” and “fully production-grade.”

### Electron shell and security shell features

Currently implemented:

- Single-instance app lock via [`electron/main.ts`](./electron/main.ts)
- Splash screen on startup via [`electron/loadScreens.ts`](./electron/loadScreens.ts)
- Safe load-failure fallback page via [`electron/loadScreens.ts`](./electron/loadScreens.ts)
- Session permission denial:
  - `setPermissionCheckHandler(() => false)`
  - `setPermissionRequestHandler(... callback(false))`
  - `setDevicePermissionHandler(() => false)`
  - `setDisplayMediaRequestHandler(... no media)`
- Blocked unmanaged downloads via `defaultSession.on("will-download", event.preventDefault())`
- Blocked webviews via `will-attach-webview`
- Blocked or restricted navigation and window creation
- Window size persistence
- OS-backed secret encryption when `safeStorage` is available

### Account setup / authentication

Status: **partially working**

Implemented:

- Account onboarding form in [`src/App.tsx`](./src/App.tsx)
- User-entered fields:
  - display name
  - email address
  - provider label
  - username
  - password/app password
  - IMAP host/port/security
  - SMTP host/port/security
  - SMTP auth mode (`auto`, `plain`, `login`, `none`)
- Secrets stored in SQLite metadata plus encrypted secret blob when `safeStorage` works

Missing / caveats:

- No OAuth or provider-specific login flows
- No runtime schema validation for IPC payloads beyond TypeScript compile-time types
- Creation marks account as `"online"` before any real server verification

### IMAP folder fetching

Status: **partially working**

Implemented in [`electron/providerClient.ts`](./electron/providerClient.ts):

- Raw IMAP over `node:net` / `node:tls`
- Supports:
  - direct TLS (`ssl_tls`)
  - STARTTLS (`starttls`)
  - plain TCP (`plain`)
- Performs:
  - greeting read
  - optional STARTTLS upgrade
  - `LOGIN`
  - `STATUS INBOX (MESSAGES UNSEEN)`
  - `LIST "" "*"`
  - `LOGOUT`
- Folders are classified into:
  - `inbox`
  - `drafts`
  - `sent`
  - `archive`
  - `custom`

Important limitation:

- The app fetches **folder names and inbox unseen count**, but it does **not** fetch real message headers or bodies from IMAP.
- This is custom socket code, not a mature IMAP library.

### Email listing / inbox display

Status: **partially working**

Implemented:

- Message list pane in [`src/App.tsx`](./src/App.tsx)
- Folder selection filters the messages shown
- Search filters currently visible local messages
- Account switching updates folder/message context

Actual source of displayed messages:

- SQLite local workspace data from [`electron/mailService.ts`](./electron/mailService.ts)
- Drafts created locally
- Sent messages written locally after SMTP send

What it does **not** do:

- It does not download the actual inbox message list from an IMAP server
- If you verify an account successfully, folders can appear, but the inbox remains empty unless local messages exist

### Email reading / viewing

Status: **partially working**

Implemented:

- Right-side reader pane for selected thread
- Thread metadata, sender, sent time, verification badge
- Plain-text message body display
- If a thread message is marked `contentMode === "html-blocked"`, the renderer displays a warning and safe text only

Limitations:

- No real HTML rendering pipeline
- No sanitization engine
- No remote image controls UI
- No real server-loaded inbox threads/bodies

### SMTP sending

Status: **partially working**

Implemented in [`electron/providerClient.ts`](./electron/providerClient.ts):

- Raw SMTP over `node:net` / `node:tls`
- Supports:
  - direct TLS
  - STARTTLS
  - plain TCP
  - `AUTH PLAIN`
  - `AUTH LOGIN`
  - no SMTP auth
- Sends plain-text messages only
- Writes sent message metadata/thread into local SQLite after successful send

Library used:

- No external mail library
- Custom protocol implementation

Current real-world state:

- It can succeed only if the configured SMTP server is reachable and the settings are correct
- The user has repeatedly hit real connection timeouts to `167.235.112.241:587`

### Draft creation

Status: **working locally**

Implemented:

- Compose form
- Save draft path
- Local `Drafts` folder auto-created per account when needed
- Draft thread/message stored in SQLite

### Search

Status: **basic / local only**

Implemented:

- Client-side search field in the message pane
- Filters `sender`, `subject`, `preview`, and `label`

Limitations:

- No full-text index
- No cross-folder search
- No server-side search
- No body search

### Folder navigation

Status: **partially working**

Implemented:

- Account-scoped folder sidebar
- Remote IMAP folders imported after verification
- Local folders created for:
  - `Drafts`
  - `Sent`
- Folder counts come from local message rows in SQLite

Limitations:

- Folder counts do not reflect real server-side counts except the account-level unseen summary
- No move/archive/delete logic
- No folder management UI

### Compose / reply / forward

Status:

- Compose: **implemented**
- Reply: **UI-only shortcut**
- Forward: **missing**

Details:

- “New message” opens compose
- “Reply” button in reader calls `openComposer(...)`, but does not pre-fill recipient, quote body, or set reply headers
- No forward button

### Attachments

Status: **missing**

There is no attachment model, no upload control, no MIME multipart generation, and no attachment rendering/downloading path.

### Notifications

Status: **missing**

No desktop notifications, unread badge notifications, or background mail alerts are implemented.

### Other implemented features

- Transparency ledger / recent events UI
- Security metrics UI
- Sync job history UI
- Cross-platform release-target metadata displayed in shell state
- Controlled error/result IPC shape for send/verify actions
- Linux post-install sandbox permission fix for `.deb` packages
- Manual Debian packaging fallback script in repo

---

## 5. BROKEN OR MISSING FEATURES

### Core mail features still missing

- Real IMAP message synchronization
- Real inbox header fetch
- Real message body fetch from server
- Folder subscription management
- Delete / trash / archive actions
- Move between folders
- Mark read/unread
- Flag/star support
- Spam/junk handling logic
- Reply with quoted thread context
- Forward
- Attachments
- HTML sanitization/rendering pipeline
- Remote image controls
- Rich-text composer
- Draft update/edit lifecycle beyond creating new draft records
- Background sync scheduler
- Push/idle updates
- Notifications
- Search indexing
- Account edit/remove UI
- OAuth and provider-specific auth
- Multiple identity/send-from support
- Signature support
- Import/export
- Auto-update pipeline
- Signing/notarization

### Implemented in UI but weak or incomplete in backend

- Settings view exists, but it is largely informational and not a real editable settings system
- Account verification fetches folders but does not populate inbox messages
- “Reply” exists as a button but is not real reply behavior
- Folder navigation looks like a real mail client, but backend mail contents are mostly local drafts/sent records

### Broken or unstable packaging/runtime areas

- AppImage is still failing on the user’s Linux machine with Chromium `setuid_sandbox_host.cc(163)` despite attempted mitigation in [`electron/main.ts`](./electron/main.ts)
- `electron-builder` Debian packaging hangs in this environment; a manual fallback script was added
- Local Windows packaging from Linux failed because `wine` is not available

### Documentation drift / inconsistencies

- [`README.md`](./README.md) says the preload bridge exposes only `getWorkspaceSnapshot()`, which is no longer true
- Some older descriptions still imply a stronger sandbox posture than the current `sandbox: false` main window setting

---

## 6. KNOWN ERRORS & BUGS

### Runtime errors and warnings observed

| Error / Warning | Origin | Trigger | Notes |
| --- | --- | --- | --- |
| `ExperimentalWarning: SQLite is an experimental feature` | `electron/mailService.ts:3` (`DatabaseSync` from `node:sqlite`) | App startup | This is a Node runtime warning, not a thrown app exception. |
| `MESA-INTEL: warning: Ivy Bridge Vulkan support is incomplete` | GPU driver / Electron runtime | App startup on the user’s Linux machine | External environment warning. |
| `libva error: ... iHD_drv_video.so init failed` | Video driver stack / Electron runtime | App startup on the user’s Linux machine | External environment warning. |
| `FATAL:setuid_sandbox_host.cc(163)` for AppImage | Chromium sandbox helper inside mounted AppImage | Launching the `.AppImage` | Still unresolved on the user’s machine. |
| `Running as root without --no-sandbox is not supported` | Chromium/Electron runtime | Launching the app with `sudo` | User should not run the app as root. |
| `Could not reach the SMTP server at <host>:<port>...` | `electron/providerClient.ts:56-89`, surfaced via `electron/mailService.ts:755-840` and `electron/main.ts:328-338` | Sending mail to an unreachable SMTP host | Current real-world problem shown repeatedly by the user. |
| Historical raw `ETIMEDOUT` / `ENETUNREACH` stack traces | Previous send path before IPC wrapping | SMTP host unreachable | The code now attempts to wrap this into a cleaner user-facing error. |
| `Account onboarding requires the Electron desktop shell.` | `src/App.tsx:293-296` | Running the renderer in browser preview without preload bridge | Intentional guard, but confusing if previewed outside Electron. |
| `Draft persistence requires the Electron desktop shell.` | `src/App.tsx:329-332` | Saving a draft outside Electron | Intentional guard. |
| `Provider verification requires the Electron desktop shell.` | `src/App.tsx:362-365` | Verifying account outside Electron | Intentional guard. |
| `Outbound delivery requires the Electron desktop shell.` | `src/App.tsx:392-395` | Sending outside Electron | Intentional guard. |
| `dejazmach-mail-client: command not found` | Linux install/runtime packaging issue | Launcher symlink missing or shell hash stale | Partially addressed by `postinst.sh`. |
| Black/unresponsive window on Linux | Earlier packaging/UI startup issue | Packaged Linux launch on older Intel GPU stack | Mitigated by `vite.config.ts` relative assets and GPU disabling in `electron/main.ts:258-265`. |
| `wine is required` during Windows build | `electron-builder` on Linux host | Attempting local Windows package build from Linux | Prevents refreshed Windows installer generation here. |

### Source-level issues and weak spots

- `electron/main.ts:163`
  - Main window uses `sandbox: false`
  - This is not an exception, but it is a security regression relative to the stated sandbox claims

- `electron/mailService.ts:258`
  - `ensureReferenceData()` is an empty stub
  - This indicates unfinished initialization logic

- `electron/providerClient.ts`
  - Custom IMAP/SMTP protocol code has no mature retry strategy, no provider-specific quirks handling, and limited error interpretation

- `src/App.tsx`
  - Reader/compose/settings routing is in a single large component
  - This is maintainable for a prototype but brittle for a larger client

- `dist-electron/electron/workspace.*`
  - Generated stale artifact from removed source file
  - Not a runtime error by itself, but it indicates build output drift

---

## 7. UI CURRENT STATE

### Current layout

The current renderer is structurally close to a modern 3-panel mail client:

- No-account state:
  - Two-column onboarding screen
  - Welcome copy on the left
  - Full account configuration form on the right
- Account state:
  - Left panel:
    - brand block
    - compose button
    - account list
    - folder list
    - settings/add account actions
  - Center panel:
    - folder title/status
    - search box
    - message list
  - Right panel:
    - either message reader
    - or compose form
    - or account/settings summary

### Styling approach

- Plain CSS in [`src/styles.css`](./src/styles.css)
- Visual style:
  - gradient page background
  - dark left rail
  - white/glass main surfaces
  - rounded cards/pills/buttons
- No icon pack, no design system library, no component primitives

### How close it is to a modern 3-panel mail client

Structurally:

- **Close**
- It now has the expected left rail / message list / reader layout

Functionally:

- **Not close enough**
- The visual shell resembles a real client, but the underlying data density and behaviors still do not match Outlook, Spark, Apple Mail, Superhuman, or Thunderbird

### Specific UI problems

- The UI often looks empty because there is no true IMAP message sync
- There is no real toolbar for common mail actions like archive, delete, move, spam, mark unread
- “Reply” is not true reply behavior
- No icons or branded assets, so some packaged artifacts still use fallback Electron icons
- No pane resizing
- No attachment chips/previews
- No message threading controls beyond basic display
- No folder action menus
- Search is only local to already-loaded message summaries
- Settings screen is mostly static account/security information
- The renderer is still a single large component rather than a decomposed production UI architecture
- The user explicitly judged the UI as “far from the best” and “the worst UI” during testing, which means current implementation does not meet stakeholder expectations even after restructuring

---

## 8. IPC COMMUNICATION AUDIT

### Renderer invokes

Defined in [`electron/preload.ts`](./electron/preload.ts):

| Channel | Renderer call | Handler exists in main? | Result type |
| --- | --- | --- | --- |
| `app:get-workspace-snapshot` | `ipcRenderer.invoke("app:get-workspace-snapshot")` | Yes | `WorkspaceSnapshot` |
| `app:create-account` | `ipcRenderer.invoke("app:create-account", input)` | Yes | `ActionResult<WorkspaceSnapshot>` |
| `app:create-draft` | `ipcRenderer.invoke("app:create-draft", input)` | Yes | `ActionResult<WorkspaceSnapshot>` |
| `app:verify-account` | `ipcRenderer.invoke("app:verify-account", accountId)` | Yes | `ActionResult<WorkspaceSnapshot>` |
| `app:send-message` | `ipcRenderer.invoke("app:send-message", input)` | Yes | `ActionResult<WorkspaceSnapshot>` |

### Main-process handlers

Defined in [`electron/main.ts`](./electron/main.ts):

| Channel | Main handler | Status |
| --- | --- | --- |
| `app:get-workspace-snapshot` | `ipcMain.handle("app:get-workspace-snapshot", ...)` | Implemented |
| `app:create-account` | `ipcMain.handle("app:create-account", ...)` | Implemented |
| `app:create-draft` | `ipcMain.handle("app:create-draft", ...)` | Implemented |
| `app:verify-account` | `ipcMain.handle("app:verify-account", ...)` | Implemented |
| `app:send-message` | `ipcMain.handle("app:send-message", ...)` | Implemented |

There are no obvious renderer-side invokes without matching handlers, and no main handlers without matching preload calls.

### Security audit observations

Positive:

- `contextBridge.exposeInMainWorld(...)` is used
- `contextIsolation: true`
- `nodeIntegration: false`
- Renderer only gets a fixed `desktopApi`
- Session permissions/downloads/webviews/navigation are heavily restricted

Concerns:

- `sandbox: false` for the main renderer window
  - This is the most significant IPC/shell security caveat in the current code
- No runtime schema validation on IPC payloads
  - TypeScript types do not protect against malformed runtime values
- Passwords originate in the renderer form and cross IPC into the main process
  - This is typical for Electron mail clients, but it means sensitive data exists in renderer memory during onboarding

Conclusion:

- The IPC design is reasonably narrow and much safer than exposing Node directly
- The current preload/IPC shape is acceptable for a prototype
- The `sandbox: false` main window setting is the main architectural compromise

---

## 9. SPECIFIC THINGS I HAVE ASKED CODEX TO DO

### Git commit message search

Recent commit messages:

- `9fde7c7` `Refactor styles for improved UI consistency and accessibility`
- `9cddbbf` `feat: add Linux GPU handling and post-install script for sandbox permissions`
- `bc86ea3` `feat: implement email client functionality with IMAP and SMTP support`
- `2417539` `style: update styles for improved UI consistency and accessibility`
- `65d4660` `feat: initialize DejAzmach mail client with core structure and UI components`

What these imply was explicitly requested:

- initial Electron + UI foundation
- IMAP/SMTP support
- Linux startup/packaging fixes
- multiple UI restyles/refactors

### TODO / FIXME search

There are no substantive `TODO` / `FIXME` comments in the authored source code.

Search hits were false positives:

- [`build/linux/package-deb.sh`](./build/linux/package-deb.sh): `mktemp ... XXXX...` matched `XXX`
- [`package-lock.json`](./package-lock.json): integrity hashes contained `BUG` / `XXX` substrings

### Explicit requests made during this project history

Based on the conversation history available in this workspace, the user explicitly asked for the following:

- Set up a “very good desktop mail client” called DejAzmach
- Use Electron or another suitable desktop stack
- Make the UI outstanding, professional, and aesthetically strong
- Make the app very secure and very transparent
- Make it production-ready across different operating systems
- Add secure load handling and other hardening behavior
- Finish the remaining work needed for production
- Implement real IMAP/SMTP account configuration
- Add encrypted/local credential storage
- Add local sync/data storage
- Build Linux and Windows packages for manual testing
- Fix Linux `.deb` startup issues
- Fix the Chromium sandbox permission problem for installed Linux packages
- Fix the black-window/non-responding packaged app issue
- Rebuild the UI because earlier versions were unacceptable
- Remove demo/preview/sample data
- Show only a welcome/configuration form before any account is added
- After adding an account, switch to a proper mail-client layout
- Use a 3-column layout:
  - account/folder sidebar
  - email list
  - reading pane
- Add settings/navigation surfaces
- Make folders come from the server, not from a static list
- Support custom folders for users whose servers do not match standard Inbox/Drafts/Sent layout
- Add IMAP/SMTP security/auth options like SSL/TLS and STARTTLS
- Fix the “Account onboarding requires the Electron desktop shell” problem
- Provide uninstall commands
- Keep improving the UI toward a reference image similar to a modern mail client mockup
- Try to make the Linux AppImage work
- Try to build a working Debian package instead
- Generate this project report and save it as `PROJECT_REPORT.md`

### Which requested items are still not completed

Not completed or only partially completed:

- Production readiness
- Truly outstanding UI quality
- Real server-backed inbox/message synchronization
- Attachments
- Full reply/forward workflow
- Reliable AppImage startup on the user’s Linux machine
- Reliable refreshed Windows installer generation from this Linux environment
- Full settings management
- Notifications
- Search beyond local loaded message summaries

---

## 10. RECOMMENDATIONS NEEDED
