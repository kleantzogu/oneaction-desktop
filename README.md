# Oneaction Desktop

Native desktop shell for [Oneaction](https://app.oneaction.app), built with Electron and TypeScript. Wraps the web app with native features: a system tray, a global "save active tab" shortcut, deep-link capture, and PDF/EPUB file associations.

## Features

- **System tray** — runs in the background; on macOS the window hides instead of quitting so playback (TTS / podcasts) survives `⌘W`.
- **Global shortcut `⌘⇧S` / `Ctrl+Shift+S`** — grabs the URL of the frontmost browser tab (Safari, Chrome, Brave, Arc, Edge, Vivaldi, Opera) via AppleScript on macOS, with a clipboard fallback, and saves it to Oneaction.
- **Deep links** — `oneaction://save?url=…` routes capture requests from the browser or other apps.
- **File associations** — opening a `.pdf` or `.epub` via the OS, dock drop, or "Open With" forwards the file bytes to the app.
- **Persistent session** — login survives restarts via a dedicated Electron session partition.
- **Single-instance** — relaunching focuses the existing window and forwards any deep link / file argument.
- **Custom user agent** — appends `OneActionDesktop/<version>` so the web app can detect the desktop client.
- **Native window chrome** — hidden inset title bar on macOS (traffic-light buttons only); native chrome on Windows/Linux.

## Requirements

- Node.js 20+
- npm 10+
- Platform tooling for packaging:
  - **macOS** — Xcode Command Line Tools
  - **Windows** — Windows 10+ for NSIS targets
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
npm run package:win     # Windows (NSIS)
npm run package:linux   # Linux (AppImage)
```

Artifacts are written to `release/`. macOS builds are currently unsigned.

## Environment variables

| Variable             | Scope       | Default                              | Purpose                              |
| -------------------- | ----------- | ------------------------------------ | ------------------------------------ |
| `ONEACTION_DEV_URL`  | dev only    | `http://localhost:3000`              | URL loaded by the dev window         |
| `ONEACTION_URL`      | packaged    | `https://app.oneaction.app/signin`   | URL loaded by the packaged app       |

## Project structure

```
src/
  main.ts          # Electron main process: window, tray, shortcut, deep links, file opens
  preload.ts       # contextBridge → window.oneactionDesktop API
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
onCaptureFile(({ name, mimeType, bytes }) => void): () => void
```

Both return a cleanup function. The renderer should register listeners on mount — the main process queues any deep link or file arriving before the renderer is ready and flushes the queue once `oneaction:renderer-ready` fires.

## Deep-link contract

```
oneaction://save?url=https://example.com/article
```

Anything else (unknown action, missing `url`, non-http(s) target) is silently ignored.

## License

Proprietary © Kleant Zogu. All rights reserved.
