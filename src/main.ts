import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  session,
  shell,
  Tray,
} from "electron";
import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import { CaptureOutbox, CaptureOutboxItem } from "./captureOutbox";
import { offlineFallbackHtml } from "./offlineFallback";
import {
  initAutoUpdates,
  getPendingUpdate,
  quitAndInstallUpdate,
  disposeAutoUpdates,
} from "./autoUpdate";

const execFileAsync = promisify(execFile);

const PROTOCOL = "oneaction";
const SAVE_CLIPBOARD_SHORTCUT = "CommandOrControl+Shift+S";
const CAPTURE_RETRY_INTERVAL_MS = 30_000;
const APP_RECOVERY_CHECK_INTERVAL_MS = 20_000;
const APP_RECOVERY_CHECK_TIMEOUT_MS = 5_000;

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
let captureOutbox: CaptureOutbox | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let recoveryTimer: NodeJS.Timeout | null = null;
let recoveryCheckInProgress = false;
let deliveryInProgress = false;
let rendererOnline = true;
let isShowingOfflineFallback = false;

// Distinguish a "real quit" (Cmd+Q, tray Quit menu) from a window-close so
// the close-to-tray handler knows whether to actually close.
let isQuitting = false;

// Deep links / file opens can arrive before the renderer is ready (cold launch).
// Queue them until the outbox has initialized.
let rendererReady = false;
const startupCaptureUrls: string[] = [];
const startupCaptureFiles: string[] = [];

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

function offlineFallbackUrl() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    offlineFallbackHtml(APP_URL),
  )}`;
}

function loadRemoteApp() {
  if (!mainWindow) return;
  stopRecoveryChecks();
  isShowingOfflineFallback = false;
  rendererReady = false;
  emitSyncStatusChanged();
  void mainWindow.loadURL(APP_URL);
}

function loadOfflineFallback(errorDescription?: string) {
  if (!mainWindow || isShowingOfflineFallback) return;
  isShowingOfflineFallback = true;
  rendererReady = false;
  if (errorDescription) {
    console.warn(`[oneaction] loading offline fallback: ${errorDescription}`);
  }
  emitSyncStatusChanged();
  void mainWindow.loadURL(offlineFallbackUrl());
  scheduleRecoveryCheck();
}

function ensureCaptureOutbox(): CaptureOutbox {
  if (!captureOutbox) {
    throw new Error("capture outbox is not initialized");
  }
  return captureOutbox;
}

function publicOutboxItems() {
  return captureOutbox?.list() ?? [];
}

function syncStatus() {
  const items = publicOutboxItems();
  return {
    rendererReady,
    online: rendererOnline,
    queuedCount: items.filter((item) => item.status === "queued").length,
    deliveredCount: items.filter((item) => item.status === "delivered").length,
    retryIntervalMs: CAPTURE_RETRY_INTERVAL_MS,
  };
}

function emitOutboxChanged() {
  rebuildTrayMenu();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(
    "oneaction:capture-outbox-changed",
    publicOutboxItems(),
  );
  mainWindow.webContents.send(
    "oneaction:sync-status-changed",
    syncStatus(),
  );
}

function emitSyncStatusChanged() {
  rebuildTrayMenu();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(
    "oneaction:sync-status-changed",
    syncStatus(),
  );
}

function emitRecoveryStatus(message: string, checking: boolean) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("oneaction:recovery-status-changed", {
    checking,
    message,
  });
}

function stopRecoveryChecks() {
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = null;
  recoveryCheckInProgress = false;
}

function scheduleRecoveryCheck(delayMs = APP_RECOVERY_CHECK_INTERVAL_MS) {
  if (!isShowingOfflineFallback) return;
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null;
    void checkRemoteAppRecovery();
  }, delayMs);
}

async function isRemoteAppReachable() {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, APP_RECOVERY_CHECK_TIMEOUT_MS);
  try {
    if (!net.isOnline()) return false;
    const response = await net.fetch(APP_URL, {
      method: "HEAD",
      signal: controller.signal,
    });
    if (response.ok) return true;
    if (response.status === 405 || response.status === 403) {
      const fallback = await net.fetch(APP_URL, {
        method: "GET",
        signal: controller.signal,
      });
      return fallback.ok;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkRemoteAppRecovery() {
  if (!isShowingOfflineFallback || recoveryCheckInProgress) return;
  recoveryCheckInProgress = true;
  emitRecoveryStatus("Checking Oneaction...", true);
  const reachable = await isRemoteAppReachable();
  recoveryCheckInProgress = false;
  if (!isShowingOfflineFallback) return;
  if (reachable) {
    emitRecoveryStatus("Oneaction is back online.", false);
    loadRemoteApp();
    return;
  }
  emitRecoveryStatus("Still offline. Captures stay local.", false);
  scheduleRecoveryCheck();
}

function scheduleCaptureDelivery(delayMs = 0) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void drainQueuedCaptures();
  }, delayMs);
}

async function dispatchCaptureItem(item: CaptureOutboxItem): Promise<boolean> {
  if (!mainWindow) return false;
  if (!rendererReady || !rendererOnline) return false;
  try {
    if (item.kind === "url") {
      mainWindow.webContents.send("oneaction:capture-item", item);
    } else {
      const bytes = await ensureCaptureOutbox().readFileBytes(item);
      mainWindow.webContents.send("oneaction:capture-item", {
        id: item.id,
        kind: item.kind,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        name: item.name,
        mimeType: item.mimeType,
        size: item.size,
        bytes,
      });
    }
    await ensureCaptureOutbox().markDelivered(item.id);
    emitOutboxChanged();
    return true;
  } catch (err) {
    console.error(`[oneaction] failed to dispatch capture ${item.id}:`, err);
    await ensureCaptureOutbox().markDeliveryFailed(item.id, err);
    emitOutboxChanged();
    return false;
  }
}

async function drainQueuedCaptures() {
  if (!rendererReady || !captureOutbox) return;
  if (!rendererOnline || deliveryInProgress) {
    emitSyncStatusChanged();
    return;
  }
  deliveryInProgress = true;
  try {
    for (const item of captureOutbox.queued()) {
      await dispatchCaptureItem(item);
    }
  } finally {
    deliveryInProgress = false;
    if (captureOutbox.queued().length > 0) {
      scheduleCaptureDelivery(CAPTURE_RETRY_INTERVAL_MS);
    }
  }
}

async function enqueueCaptureUrl(url: string) {
  if (!captureOutbox) {
    startupCaptureUrls.push(url);
    return;
  }
  await captureOutbox.enqueueUrl(url);
  emitOutboxChanged();
  scheduleCaptureDelivery();
}

async function enqueueCaptureFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = SUPPORTED_FILE_EXTS[ext];
  if (!mimeType) {
    console.warn(`[oneaction] ignored unsupported file type: ${filePath}`);
    return;
  }
  if (!captureOutbox) {
    startupCaptureFiles.push(filePath);
    return;
  }
  try {
    await captureOutbox.enqueueFile(filePath, mimeType);
    emitOutboxChanged();
    scheduleCaptureDelivery();
  } catch (err) {
    console.error(`[oneaction] failed to queue ${filePath}:`, err);
  }
}

async function flushStartupCaptures() {
  while (startupCaptureUrls.length > 0) {
    const next = startupCaptureUrls.shift()!;
    await enqueueCaptureUrl(next);
  }
  while (startupCaptureFiles.length > 0) {
    const next = startupCaptureFiles.shift()!;
    await enqueueCaptureFile(next);
  }
}

function handleDeepLink(rawUrl: string) {
  const captureUrl = extractCaptureUrl(rawUrl);
  if (!captureUrl) return;
  focusMainWindow();
  void enqueueCaptureUrl(captureUrl);
}

function handleOpenFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_FILE_EXTS[ext]) return;
  focusMainWindow();
  void enqueueCaptureFile(filePath);
}

function notify(body: string) {
  if (!Notification.isSupported()) return;
  new Notification({ title: "Oneaction", body, silent: true }).show();
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
  tray.setToolTip("Oneaction");
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
  const status = syncStatus();
  const waitingCount = status.queuedCount + status.deliveredCount;
  const outboxLabel =
    waitingCount === 1 ? "1 capture waiting" : `${waitingCount} captures waiting`;
  const pendingUpdate = getPendingUpdate();
  const menu = Menu.buildFromTemplate([
    {
      label: "Open Oneaction",
      click: () => {
        if (!mainWindow) createWindow();
        else focusMainWindow();
      },
    },
    {
      label: waitingCount > 0 ? outboxLabel : "No captures waiting",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Save active page",
      accelerator: SAVE_CLIPBOARD_SHORTCUT,
      click: () => {
        void handleSaveActiveTab();
      },
    },
    {
      label: "Open offline queue",
      enabled: waitingCount > 0 || isShowingOfflineFallback,
      click: () => {
        if (!mainWindow) createWindow();
        else focusMainWindow();
        if (!isShowingOfflineFallback) loadOfflineFallback();
        mainWindow?.webContents.send("oneaction:open-offline-queue");
      },
    },
    {
      label: "Retry app",
      enabled: isShowingOfflineFallback,
      click: () => {
        if (!mainWindow) createWindow();
        else focusMainWindow();
        loadRemoteApp();
      },
    },
    { type: "separator" },
    ...(pendingUpdate
      ? ([
          {
            label: `Restart to update Oneaction (v${pendingUpdate.version})`,
            click: () => {
              isQuitting = true;
              quitAndInstallUpdate();
            },
          },
          { type: "separator" },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: "Quit Oneaction",
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
  await enqueueCaptureUrl(url);
  try {
    notify(`Queued from ${new URL(url).hostname.replace(/^www\./, "")}`);
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
    title: "Oneaction",
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
    emitSyncStatusChanged();
  };
  mainWindow.webContents.on("did-start-loading", resetRendererReady);
  mainWindow.webContents.on("did-start-navigation", resetRendererReady);
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, _errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || isShowingOfflineFallback) return;
      if (validatedURL === APP_URL || validatedURL.startsWith(APP_URL)) {
        loadOfflineFallback(errorDescription);
      }
    },
  );

  loadRemoteApp();

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
    emitOutboxChanged();
    scheduleCaptureDelivery();
  });

  ipcMain.on("oneaction:renderer-online-status", (_event, online) => {
    if (typeof online !== "boolean") return;
    const wasOnline = rendererOnline;
    rendererOnline = online;
    emitSyncStatusChanged();
    if (!wasOnline && rendererOnline) {
      scheduleCaptureDelivery();
    }
  });

  ipcMain.handle("oneaction:get-capture-outbox", () => {
    return publicOutboxItems();
  });

  ipcMain.handle("oneaction:get-sync-status", () => {
    return syncStatus();
  });

  ipcMain.handle("oneaction:retry-app-load", () => {
    loadRemoteApp();
  });

  ipcMain.handle("oneaction:capture-url", async (event, rawUrl) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return publicOutboxItems();
    }
    if (typeof rawUrl !== "string") return publicOutboxItems();
    const url = normalizeCapturableUrl(rawUrl);
    if (!url) return publicOutboxItems();
    await enqueueCaptureUrl(url);
    return publicOutboxItems();
  });

  ipcMain.handle("oneaction:mark-capture-synced", async (_event, id) => {
    if (typeof id !== "string") return publicOutboxItems();
    await captureOutbox?.remove(id);
    emitOutboxChanged();
    return publicOutboxItems();
  });

  ipcMain.handle("oneaction:remove-capture-outbox-item", async (_event, id) => {
    if (typeof id !== "string") return publicOutboxItems();
    await captureOutbox?.remove(id);
    emitOutboxChanged();
    return publicOutboxItems();
  });

  ipcMain.handle("oneaction:redeliver-capture-outbox-item", async (_event, id) => {
    if (typeof id !== "string" || !captureOutbox) return false;
    const item = captureOutbox.get(id);
    if (!item) return false;
    return dispatchCaptureItem(item);
  });

  ipcMain.handle("oneaction:open-capture-outbox-item", async (_event, id) => {
    if (typeof id !== "string" || !captureOutbox) return false;
    const item = captureOutbox.get(id);
    if (!item) return false;
    if (item.kind === "url") {
      await shell.openExternal(item.url);
      return true;
    }
    const error = await shell.openPath(item.filePath);
    if (error) {
      console.warn(`[oneaction] failed to open ${item.filePath}: ${error}`);
      return false;
    }
    return true;
  });

  ipcMain.handle("oneaction:capture-dropped-files", async (event, filePaths) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return publicOutboxItems();
    }
    if (!Array.isArray(filePaths)) return publicOutboxItems();
    for (const filePath of filePaths) {
      if (typeof filePath !== "string") continue;
      await enqueueCaptureFile(filePath);
    }
    return publicOutboxItems();
  });

  // Cmd+Q (and any other quit path) needs to bypass the close-to-tray
  // handler, otherwise the app never actually quits.
  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.whenReady().then(async () => {
    captureOutbox = new CaptureOutbox(app.getPath("userData"));
    await captureOutbox.load();

    // Dock branding only kicks in for packaged builds, where macOS reads
    // build/oneaction.icon via CFBundleIconName. In dev the dock shows
    // Electron's atom — accepted trade-off, since faking it with a flat
    // PNG diverges from how the catalog actually renders.
    createWindow();
    createTray();
    // Auto-updates: check GitHub Releases on launch + every 6h, notify on download.
    initAutoUpdates({ notify, onStateChange: rebuildTrayMenu });

    for (const arg of process.argv) {
      if (arg.startsWith(`${PROTOCOL}://`)) {
        handleDeepLink(arg);
        continue;
      }
      const ext = path.extname(arg).toLowerCase();
      if (SUPPORTED_FILE_EXTS[ext]) handleOpenFile(arg);
    }

    await flushStartupCaptures();

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
    disposeAutoUpdates();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
