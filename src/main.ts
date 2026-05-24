import { app, BrowserWindow, session, shell } from 'electron';
import * as path from 'path';

const isDev = !app.isPackaged;
const APP_URL = isDev
  ? (process.env.ONEACTION_DEV_URL ?? 'http://localhost:3000')
  : (process.env.ONEACTION_URL ?? 'https://oneaction.app');

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  // Named partition so Clerk cookies + localStorage survive restarts.
  const persistentSession = session.fromPartition('persist:oneaction');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'OneAction',
    webPreferences: {
      session: persistentSession,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Tag UA so server middleware can recognize the desktop client.
  const currentUA = mainWindow.webContents.getUserAgent();
  mainWindow.webContents.setUserAgent(`${currentUA} OneActionDesktop/${app.getVersion()}`);

  mainWindow.loadURL(APP_URL);

  // External links open in the system browser, not in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin !== new URL(APP_URL).origin) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    } catch {
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
