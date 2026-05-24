import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import * as fs from "fs/promises";
import * as path from "path";

const PROTOCOL = "oneaction";

const SUPPORTED_FILE_EXTS: Record<string, string> = {
  ".pdf": "application/pdf",
  ".epub": "application/epub+zip",
};

const isDev = !app.isPackaged;
const APP_URL = isDev
  ? (process.env.ONEACTION_DEV_URL ?? "http://localhost:3000")
  : (process.env.ONEACTION_URL ?? "https://oneaction.app");

let mainWindow: BrowserWindow | null = null;

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
      // Send the underlying ArrayBuffer slice so structured clone transmits
      // it as a typed array without dragging the whole Buffer subclass.
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

  const resetRendererReady = () => {
    rendererReady = false;
  };
  mainWindow.webContents.on("did-start-loading", resetRendererReady);
  mainWindow.webContents.on("did-start-navigation", resetRendererReady);

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
    // Windows / Linux deliver file paths in argv on second-instance launches.
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

  // macOS delivers file drops / Open With / share extensions via open-file.
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
    // Files are processed sequentially since each read is async and we want
    // deterministic delivery order.
    while (pendingCaptureFiles.length > 0) {
      const next = pendingCaptureFiles.shift()!;
      await sendCaptureFile(next);
    }
  });

  app.whenReady().then(() => {
    createWindow();

    // Windows / Linux cold launch: deep links + file paths come in via argv.
    for (const arg of process.argv) {
      if (arg.startsWith(`${PROTOCOL}://`)) {
        handleDeepLink(arg);
        continue;
      }
      const ext = path.extname(arg).toLowerCase();
      if (SUPPORTED_FILE_EXTS[ext]) handleOpenFile(arg);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
