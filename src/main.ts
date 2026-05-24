import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  session,
  shell,
  Tray,
} from "electron";
import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const PROTOCOL = "oneaction";
const SAVE_CLIPBOARD_SHORTCUT = "CommandOrControl+Shift+S";

const SUPPORTED_FILE_EXTS: Record<string, string> = {
  ".pdf": "application/pdf",
  ".epub": "application/epub+zip",
};

const isDev = !app.isPackaged;
const APP_URL = isDev
  ? (process.env.ONEACTION_DEV_URL ?? "http://localhost:3000")
  : (process.env.ONEACTION_URL ?? "https://app.oneaction.app/signin");

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Distinguish a "real quit" (Cmd+Q, tray Quit menu) from a window-close so
// the close-to-tray handler knows whether to actually close.
let isQuitting = false;

// Deep links / file opens can arrive before the renderer is ready (cold launch).
// Queue them until the renderer signals it's listening.
let rendererReady = false;
const pendingCaptureUrls: string[] = [];
const pendingCaptureFiles: string[] = [];

function extractCaptureUrl(deepLink: string): string | null {
  try {
    const u = new URL(deepLink);
    if (u.protocol !== `${PROTOCOL}:`) return null;
    const action = (u.host || u.pathname.replace(/^\/+/, "")).toLowerCase();
    if (action !== "save") return null;
    const target = u.searchParams.get("url");
    if (!target) return null;
    return target;
  } catch {
    return null;
  }
}

function normalizeCapturableUrl(text: string): string | null {
  try {
    const u = new URL(text.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function dispatchCapture(url: string) {
  if (!mainWindow) return;
  if (!rendererReady) {
    pendingCaptureUrls.push(url);
    return;
  }
  mainWindow.webContents.send("oneaction:capture", url);
}

async function dispatchCaptureFile(filePath: string) {
  if (!mainWindow) return;
  if (!rendererReady) {
    pendingCaptureFiles.push(filePath);
    return;
  }
  await sendCaptureFile(filePath);
}

async function sendCaptureFile(filePath: string) {
  if (!mainWindow) return;
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = SUPPORTED_FILE_EXTS[ext];
  if (!mimeType) {
    console.warn(`[oneaction] ignored unsupported file type: ${filePath}`);
    return;
  }
  try {
    const buffer = await fs.readFile(filePath);
    mainWindow.webContents.send("oneaction:capture-file", {
      name: path.basename(filePath),
      mimeType,
      bytes: new Uint8Array(buffer),
    });
  } catch (err) {
    console.error(`[oneaction] failed to read ${filePath}:`, err);
  }
}

function handleDeepLink(rawUrl: string) {
  const captureUrl = extractCaptureUrl(rawUrl);
  if (!captureUrl) return;
  focusMainWindow();
  dispatchCapture(captureUrl);
}

function handleOpenFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_FILE_EXTS[ext]) return;
  focusMainWindow();
  void dispatchCaptureFile(filePath);
}

function notify(body: string) {
  if (!Notification.isSupported()) return;
  new Notification({ title: "OneAction", body, silent: true }).show();
}

function trayIconImage() {
  // Monochrome silhouette designed for macOS template behavior — macOS
  // auto-inverts the pixel colors to match the menu bar (white in dark mode,
  // black in light mode), matching how Slack/Notion/GitHub Desktop look.
  // Electron auto-picks the @2x variant for Retina based on filename.
  const sourcePath = path.join(__dirname, "..", "build", "tray-icon.png");
  const img = nativeImage.createFromPath(sourcePath);
  img.setTemplateImage(true);
  return img;
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayIconImage());
  tray.setToolTip("OneAction");
  rebuildTrayMenu();

  // macOS opens the context menu on click for tray icons with a menu, which is
  // standard. On Windows/Linux, click should toggle visibility — context menu
  // appears on right-click.
  if (process.platform !== "darwin") {
    tray.on("click", () => {
      if (!mainWindow) {
        createWindow();
        return;
      }
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        focusMainWindow();
      }
    });
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: "Open OneAction",
      click: () => {
        if (!mainWindow) createWindow();
        else focusMainWindow();
      },
    },
    { type: "separator" },
    {
      label: "Save active page",
      accelerator: SAVE_CLIPBOARD_SHORTCUT,
      click: () => {
        void handleSaveActiveTab();
      },
    },
    { type: "separator" },
    {
      label: "Quit OneAction",
      accelerator: "CmdOrCtrl+Q",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

// AppleScript dictionaries: Safari uses `front document`; Chromium-based
// browsers use `active tab of front window` and accept the app name dynamically.
// Firefox has no AppleScript URL support and is intentionally omitted —
// the clipboard fallback covers it.
const ACTIVE_TAB_APPLESCRIPT = `
tell application "System Events"
  set frontApp to name of first application process whose frontmost is true
end tell

if frontApp is "Safari" then
  tell application "Safari"
    if (count of documents) > 0 then return URL of front document
  end tell
else if frontApp is in {"Google Chrome", "Google Chrome Canary", "Brave Browser", "Arc", "Microsoft Edge", "Vivaldi", "Opera"} then
  using terms from application "Google Chrome"
    tell application frontApp
      if (count of windows) > 0 then return URL of active tab of front window
    end tell
  end using terms from
end if
return ""
`;

async function getActiveBrowserUrl(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      ACTIVE_TAB_APPLESCRIPT,
    ]);
    return normalizeCapturableUrl(stdout);
  } catch {
    // Most likely cause: user has not granted automation permission yet,
    // or no supported browser is frontmost. Either way fall through to
    // the clipboard path so the shortcut still feels responsive.
    return null;
  }
}

async function handleSaveActiveTab() {
  // Prefer the URL of the page the user is actively viewing — feels like
  // magic. Clipboard is the fallback when no supported browser is frontmost.
  const url =
    (await getActiveBrowserUrl()) ??
    normalizeCapturableUrl(clipboard.readText());

  if (!url) {
    notify(
      "Open a page in Safari/Chrome (or copy a URL) and press the shortcut to save.",
    );
    return;
  }
  // Bring the app back if it was fully closed so the renderer can pick up the
  // queued capture. Don't focus — the whole point of the shortcut is to save
  // without context-switching.
  if (!mainWindow) createWindow();
  dispatchCapture(url);
  try {
    notify(`Saved from ${new URL(url).hostname.replace(/^www\./, "")}`);
  } catch {
    /* notification is just confirmation — never fatal */
  }
}

function createWindow() {
  const persistentSession = session.fromPartition("persist:oneaction");

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "OneAction",
    // Hide the title bar but keep the macOS traffic-light buttons inset so
    // the webapp content extends to the top edge. Non-macOS keeps the
    // default chrome (Windows/Linux don't have an equivalent native pattern).
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      session: persistentSession,
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const currentUA = mainWindow.webContents.getUserAgent();
  mainWindow.webContents.setUserAgent(
    `${currentUA} OneActionDesktop/${app.getVersion()}`,
  );

  mainWindow.loadURL(APP_URL);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin !== new URL(APP_URL).origin) {
        shell.openExternal(url);
        return { action: "deny" };
      }
    } catch {
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  const resetRendererReady = () => {
    rendererReady = false;
  };
  mainWindow.webContents.on("did-start-loading", resetRendererReady);
  mainWindow.webContents.on("did-start-navigation", resetRendererReady);

  // Close-to-tray on macOS: hiding the window keeps the renderer (and any
  // TTS / podcast playback) alive. Standard Slack-style. On Windows/Linux
  // the X actually quits — closer to platform convention there.
  mainWindow.on("close", (event) => {
    if (isQuitting || process.platform !== "darwin") return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    rendererReady = false;
    pendingCaptureUrls.length = 0;
    pendingCaptureFiles.length = 0;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    focusMainWindow();
    const deepLink = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (deepLink) handleDeepLink(deepLink);
    for (const arg of argv) {
      const ext = path.extname(arg).toLowerCase();
      if (SUPPORTED_FILE_EXTS[ext]) handleOpenFile(arg);
    }
  });

  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]!),
    ]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    handleOpenFile(filePath);
  });

  ipcMain.on("oneaction:renderer-ready", async (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    rendererReady = true;
    while (pendingCaptureUrls.length > 0) {
      const next = pendingCaptureUrls.shift()!;
      mainWindow.webContents.send("oneaction:capture", next);
    }
    while (pendingCaptureFiles.length > 0) {
      const next = pendingCaptureFiles.shift()!;
      await sendCaptureFile(next);
    }
  });

  // Cmd+Q (and any other quit path) needs to bypass the close-to-tray
  // handler, otherwise the app never actually quits.
  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.whenReady().then(() => {
    // Dock branding only kicks in for packaged builds, where macOS reads
    // build/oneaction.icon via CFBundleIconName. In dev the dock shows
    // Electron's atom — accepted trade-off, since faking it with a flat
    // PNG diverges from how the catalog actually renders.
    createWindow();
    createTray();

    for (const arg of process.argv) {
      if (arg.startsWith(`${PROTOCOL}://`)) {
        handleDeepLink(arg);
        continue;
      }
      const ext = path.extname(arg).toLowerCase();
      if (SUPPORTED_FILE_EXTS[ext]) handleOpenFile(arg);
    }

    const registered = globalShortcut.register(SAVE_CLIPBOARD_SHORTCUT, () => {
      void handleSaveActiveTab();
    });
    if (!registered) {
      console.warn(
        `[oneaction] failed to register global shortcut ${SAVE_CLIPBOARD_SHORTCUT} — likely already taken by another app`,
      );
    }

    app.on("activate", () => {
      // Dock-click after close-to-tray: window exists but is hidden — show it
      // rather than create a duplicate.
      if (!mainWindow) {
        createWindow();
      } else {
        focusMainWindow();
      }
    });
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
