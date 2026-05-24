import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import * as path from "path";

const PROTOCOL = "oneaction";

const isDev = !app.isPackaged;
const APP_URL = isDev
  ? (process.env.ONEACTION_DEV_URL ?? "http://localhost:3000")
  : (process.env.ONEACTION_URL ?? "https://oneaction.app");

let mainWindow: BrowserWindow | null = null;

// Deep links can arrive before the renderer is ready (cold launch via
// `open oneaction://...`). Queue them until the renderer signals it's listening.
let rendererReady = false;
const pendingCaptureUrls: string[] = [];

function extractCaptureUrl(deepLink: string): string | null {
  try {
    const u = new URL(deepLink);
    if (u.protocol !== `${PROTOCOL}:`) return null;
    // Accept both `oneaction://save?url=...` (host = "save") and
    // `oneaction:save?url=...` (pathname = "save") since Chromium parses
    // these inconsistently across platforms.
    const action = (u.host || u.pathname.replace(/^\/+/, "")).toLowerCase();
    if (action !== "save") return null;
    const target = u.searchParams.get("url");
    if (!target) return null;
    return target;
  } catch {
    return null;
  }
}

function dispatchCapture(url: string) {
  if (!mainWindow) return;
  if (!rendererReady) {
    pendingCaptureUrls.push(url);
    return;
  }
  mainWindow.webContents.send("oneaction:capture", url);
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function handleDeepLink(rawUrl: string) {
  const captureUrl = extractCaptureUrl(rawUrl);
  if (!captureUrl) return;
  focusMainWindow();
  dispatchCapture(captureUrl);
}

function createWindow() {
  const persistentSession = session.fromPartition("persist:oneaction");

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "OneAction",
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

  // Renderer state resets on every navigation/reload; require a fresh
  // ready ping each time before dispatching.
  const resetRendererReady = () => {
    rendererReady = false;
  };
  mainWindow.webContents.on("did-start-loading", resetRendererReady);
  mainWindow.webContents.on("did-start-navigation", resetRendererReady);

  mainWindow.on("closed", () => {
    mainWindow = null;
    rendererReady = false;
    pendingCaptureUrls.length = 0;
  });
}

// Without a single-instance lock, every `open oneaction://...` would spawn
// a fresh Electron process instead of activating the running one.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    focusMainWindow();
    // Windows / Linux deliver the deep link in argv of the second instance.
    const deepLink = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (deepLink) handleDeepLink(deepLink);
  });

  // The setAsDefaultProtocolClient call is a no-op in dev unless a path is
  // passed; we pass process.execPath + the compiled entrypoint so macOS /
  // Windows know how to relaunch us for an `oneaction://` URL while running
  // `npm start`. In packaged builds, Electron handles this automatically.
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]!),
    ]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  // macOS delivers deep links through the open-url event, not argv.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  ipcMain.on("oneaction:renderer-ready", (event) => {
    if (mainWindow && event.sender === mainWindow.webContents) {
      rendererReady = true;
      while (pendingCaptureUrls.length > 0) {
        const next = pendingCaptureUrls.shift()!;
        mainWindow.webContents.send("oneaction:capture", next);
      }
    }
  });

  app.whenReady().then(() => {
    createWindow();

    // Windows / Linux cold launch: the deep link is in the initial argv.
    const initialDeepLink = process.argv.find((arg) =>
      arg.startsWith(`${PROTOCOL}://`),
    );
    if (initialDeepLink) handleDeepLink(initialDeepLink);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
