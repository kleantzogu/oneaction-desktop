# Oneaction Desktop

Native desktop shell for [Oneaction](https://app.oneaction.app), built with Electron and TypeScript. Wraps the web app with native features: a system tray, a global "save active tab" shortcut, deep-link capture, and PDF/EPUB file associations.

## Features

- **System tray** — runs in the background; on macOS the window hides instead of quitting so playback (TTS / podcasts) survives `⌘W`.
- **Global shortcut `⌘⇧S` / `Ctrl+Shift+S`** — grabs the URL of the frontmost browser tab (Safari, Chrome, Brave, Arc, Edge, Vivaldi, Opera) via AppleScript on macOS, with a clipboard fallback, and saves it to Oneaction.
- **Deep links** — `oneaction://save?url=…` routes capture requests from the browser or other apps.
- **File associations** — opening a `.pdf` or `.epub` via the OS, dock drop, or "Open With" forwards the file bytes to the app.
- **Offline capture outbox** — URL and PDF/EPUB captures are persisted locally before delivery to the renderer, so captures made while the web app is unavailable can be delivered later.
- **Capture retry status** — queued captures are retried when the renderer becomes ready or the app comes back online, with delivery attempt metadata exposed to the web app.
- **Offline fallback UI** — when the hosted app cannot load, Electron shows a centered local recovery state; the detailed outbox opens only when the user chooses to inspect it.
- **Tray outbox status** — the tray menu shows waiting capture counts and can open the offline queue or retry the hosted app.
- **Automatic app recovery** — while the local fallback is showing, Electron quietly probes the hosted app and reloads it when it becomes reachable again.
- **Persistent session** — login survives restarts via a dedicated Electron session partition.
- **Single-instance** — relaunching focuses the existing window and forwards any deep link / file argument.
- **Custom user agent** — appends `OneActionDesktop/<version>` so the web app can detect the desktop client.
- **Native window chrome** — hidden inset title bar on macOS (traffic-light buttons only); native chrome on Linux.

## Requirements

- Node.js 20+
- npm 10+
- Platform tooling for packaging:
  - **macOS** — Xcode Command Line Tools
  - **Linux** — standard build essentials for AppImage

## Install

```bash
git clone https://github.com/kleantzogu/oneaction-desktop.git
cd oneaction-desktop
npm install
```

## Development

```bash
npm start          # one-shot: build + launch Electron
npm run dev        # tsc --watch for hot recompile
```

By default a dev build loads `http://localhost:3000`. Override with `ONEACTION_DEV_URL` if your web app is running elsewhere:

```bash
ONEACTION_DEV_URL=http://localhost:3001 npm start
```

## Packaging

```bash
npm run package         # current platform
npm run package:mac     # macOS (dmg + zip, arm64 + x64)
npm run package:mac:notarized
npm run package:linux   # Linux (AppImage)
```

Artifacts are written to `release/`. Windows builds are intentionally not produced until Windows code signing is configured.

`npm run package:mac:notarized` performs a notarization credential preflight before running the macOS package build. Electron Builder notarizes automatically when `build.mac.notarize` is enabled and one complete credential group is present:

- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`
- `APPLE_KEYCHAIN_PROFILE` with optional `APPLE_KEYCHAIN`

## Environment variables

| Variable             | Scope       | Default                              | Purpose                              |
| -------------------- | ----------- | ------------------------------------ | ------------------------------------ |
| `ONEACTION_DEV_URL`  | dev only    | `http://localhost:3000`              | URL loaded by the dev window         |
| `ONEACTION_URL`      | packaged    | `https://app.oneaction.app/signin`   | URL loaded by the packaged app       |
| `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` | macOS release | unset | App Store Connect API key credentials for notarization |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | macOS release | unset | Apple ID credentials for notarization |
| `APPLE_KEYCHAIN_PROFILE` / `APPLE_KEYCHAIN` | macOS release | unset | Stored `xcrun notarytool` profile for notarization |

## Project structure

```
src/
  main.ts          # Electron main process: window, tray, shortcut, deep links, file opens
  preload.ts       # contextBridge → window.oneactionDesktop API
  captureOutbox.ts # durable local capture queue
  offlineFallback.ts # bundled fallback UI for failed remote loads
build/
  oneaction.icns   # app icon (macOS)
  tray-icon.png    # template tray icon (macOS auto-inverts for dark/light)
dist/              # tsc output (generated)
release/           # electron-builder output (generated)
```

## Renderer bridge

The preload exposes a minimal API to the web app via `window.oneactionDesktop`:

```ts
onCapture((url: string) => void): () => void
onCaptureFile(({ id, name, mimeType, size, bytes }) => void): () => void
onCaptureItem((item) => void): () => void
getCaptureOutbox(): Promise<CaptureOutboxItem[]>
getSyncStatus(): Promise<SyncStatus>
markCaptureSynced(id: string): Promise<CaptureOutboxItem[]>
removeCaptureOutboxItem(id: string): Promise<CaptureOutboxItem[]>
redeliverCaptureOutboxItem(id: string): Promise<boolean>
openCaptureOutboxItem(id: string): Promise<boolean>
retryAppLoad(): Promise<void>
captureDroppedFiles(files: File[]): Promise<CaptureOutboxItem[]>
captureUrl(url: string): Promise<CaptureOutboxItem[]>
onFileDragChanged((isDragging: boolean) => void): () => void
onDroppedFilesCaptured((items: CaptureOutboxItem[]) => void): () => void
onOpenOfflineQueue(() => void): () => void
onCaptureOutboxChanged((items: CaptureOutboxItem[]) => void): () => void
onSyncStatusChanged((status: SyncStatus) => void): () => void
onRecoveryStatusChanged((status: RecoveryStatus) => void): () => void
```

The legacy `onCapture` and `onCaptureFile` APIs remain available, but new renderer code should prefer `onCaptureItem` because each capture includes a stable local outbox `id`.

The main process writes captures to the local outbox before delivery. When the renderer registers a listener and reports online status, queued items are delivered and marked `delivered`; they remain in the outbox until the web app confirms successful upload with `markCaptureSynced(id)`. Use `getCaptureOutbox()` on startup to inspect local captures that still need server sync, `getSyncStatus()` / `onSyncStatusChanged()` to render retry state, and `redeliverCaptureOutboxItem(id)` when the user manually retries an item.

`CaptureOutboxItem` includes `deliveryAttempts`, `lastDeliveredAt`, and `lastError` so the renderer can distinguish never-delivered local captures from captures that were handed to the web app but not yet acknowledged by the server.

If the main app URL fails to load, the desktop shell swaps to a local offline fallback page bundled in the app. The fallback first shows a centered recovery state with retry and queue actions. Opening the queue uses the same outbox APIs to show queued and delivered local captures, remove abandoned items, and call `retryAppLoad()` to attempt the hosted app again. Dropping PDF/EPUB files onto the fallback page calls `captureDroppedFiles(files)` and queues supported files locally; pasting an HTTP(S) URL calls `captureUrl(url)`.

Queued files can be opened from their local outbox copy with `openCaptureOutboxItem(id)`. URL items open externally.

## Deep-link contract

```
oneaction://save?url=https://example.com/article
```

Anything else (unknown action, missing `url`, non-http(s) target) is silently ignored.

## License

Proprietary © Kleant Zogu. All rights reserved.
