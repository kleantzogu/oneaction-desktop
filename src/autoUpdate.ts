import { app } from "electron";
import { autoUpdater } from "electron-updater";

export interface UpdaterLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown> | unknown;
  quitAndInstall(): void;
}

export interface PendingUpdate {
  version: string;
}

export interface UpdateControllerDeps {
  notify: (body: string) => void;
  onStateChange: () => void;
  log?: (message: string) => void;
}

export interface UpdateController {
  start(): void;
  checkNow(): void;
  getPendingUpdate(): PendingUpdate | null;
  quitAndInstall(): void;
}

export function createUpdateController(
  updater: UpdaterLike,
  deps: UpdateControllerDeps,
): UpdateController {
  let pending: PendingUpdate | null = null;
  let checkInProgress = false;
  const log = deps.log ?? (() => {});

  function start(): void {
    updater.on("update-downloaded", (info: { version: string }) => {
      checkInProgress = false;
      pending = { version: info.version };
      log(`update downloaded: ${info.version}`);
      deps.notify(`Update ready — restart Oneaction to apply v${info.version}.`);
      deps.onStateChange();
    });
    updater.on("update-not-available", () => {
      checkInProgress = false;
    });
    updater.on("error", (err: Error) => {
      checkInProgress = false;
      log(`update error: ${err?.message ?? String(err)}`);
    });
  }

  function checkNow(): void {
    if (checkInProgress) return;
    checkInProgress = true;
    Promise.resolve(updater.checkForUpdates()).catch((err: unknown) => {
      checkInProgress = false;
      const message = err instanceof Error ? err.message : String(err);
      log(`checkForUpdates failed: ${message}`);
    });
  }

  return {
    start,
    checkNow,
    getPendingUpdate: () => pending,
    quitAndInstall: () => updater.quitAndInstall(),
  };
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FIRST_CHECK_DELAY_MS = 8_000; // let the window settle before first check

let controller: UpdateController | null = null;
let intervalTimer: NodeJS.Timeout | null = null;
let timeoutTimer: NodeJS.Timeout | null = null;

export function initAutoUpdates(deps: UpdateControllerDeps): void {
  // electron-updater no-ops in dev but logs noisy errors; only run when packaged.
  if (!app.isPackaged) return;
  if (controller) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Route updater logs to console (electron-updater accepts any info/warn/error logger).
  autoUpdater.logger = console as unknown as typeof autoUpdater.logger;

  const log = (message: string) => console.log(`[oneaction-updater] ${message}`);
  controller = createUpdateController(autoUpdater as unknown as UpdaterLike, {
    ...deps,
    log,
  });
  controller.start();

  timeoutTimer = setTimeout(() => controller?.checkNow(), FIRST_CHECK_DELAY_MS);
  intervalTimer = setInterval(() => controller?.checkNow(), CHECK_INTERVAL_MS);
}

export function getPendingUpdate(): PendingUpdate | null {
  return controller?.getPendingUpdate() ?? null;
}

export function quitAndInstallUpdate(): void {
  controller?.quitAndInstall();
}

export function disposeAutoUpdates(): void {
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  controller = null;
}
