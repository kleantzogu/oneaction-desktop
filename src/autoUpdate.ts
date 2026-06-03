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
