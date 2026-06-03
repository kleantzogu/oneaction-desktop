import { contextBridge, ipcRenderer, webUtils } from "electron";

type CaptureHandler = (url: string) => void;
type CaptureFilePayload = {
  id?: string;
  name: string;
  mimeType: string;
  size?: number;
  bytes: Uint8Array;
};
type CaptureFileHandler = (file: CaptureFilePayload) => void;
type CaptureOutboxStatus = "queued" | "delivered";
type CaptureOutboxBase = {
  id: string;
  status: CaptureOutboxStatus;
  createdAt: string;
  updatedAt: string;
  deliveryAttempts: number;
  lastDeliveredAt?: string;
  lastError?: string;
};
type CaptureUrlOutboxItem = CaptureOutboxBase & {
  kind: "url";
  url: string;
};
type CaptureFileOutboxItem = CaptureOutboxBase & {
  kind: "file";
  name: string;
  mimeType: string;
  size: number;
};
type CaptureOutboxItem = CaptureUrlOutboxItem | CaptureFileOutboxItem;
type CaptureItemPayload =
  | CaptureUrlOutboxItem
  | (CaptureFileOutboxItem & { bytes: Uint8Array });
type CaptureItemHandler = (item: CaptureItemPayload) => void;
type CaptureOutboxHandler = (items: CaptureOutboxItem[]) => void;
type FileDragHandler = (isDragging: boolean) => void;
type OpenQueueHandler = () => void;
type SyncStatus = {
  rendererReady: boolean;
  online: boolean;
  queuedCount: number;
  deliveredCount: number;
  retryIntervalMs: number;
};
type SyncStatusHandler = (status: SyncStatus) => void;
type RecoveryStatus = {
  checking: boolean;
  message: string;
};
type RecoveryStatusHandler = (status: RecoveryStatus) => void;
const fileDragHandlers = new Set<FileDragHandler>();
const droppedFilesCapturedHandlers = new Set<CaptureOutboxHandler>();

function notifyNetworkStatus() {
  ipcRenderer.send("oneaction:renderer-online-status", navigator.onLine);
}

function notifyRendererReady() {
  ipcRenderer.send("oneaction:renderer-ready");
  notifyNetworkStatus();
}

function pathsForFiles(files: ArrayLike<File>): string[] {
  return Array.from(files)
    .map((file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return "";
      }
    })
    .filter((filePath) => filePath.length > 0);
}

function hasDraggedFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

async function captureDroppedFileList(files: ArrayLike<File>) {
  const paths = pathsForFiles(files);
  if (paths.length === 0) return [];
  return ipcRenderer.invoke("oneaction:capture-dropped-files", paths);
}

function emitFileDragState(isDragging: boolean) {
  for (const handler of fileDragHandlers) handler(isDragging);
}

function emitDroppedFilesCaptured(items: CaptureOutboxItem[]) {
  for (const handler of droppedFilesCapturedHandlers) handler(items);
}

const api = {
  /**
   * Register a handler for capture deep links sent from the main process
   * (e.g. `oneaction://save?url=...`). Returns a cleanup function that
   * removes the listener.
   */
  onCapture(handler: CaptureHandler): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      item: CaptureItemPayload,
    ) => {
      if (item.kind === "url") handler(item.url);
    };
    ipcRenderer.on("oneaction:capture-item", listener);
    // Tell main we're ready so any deep links queued during startup get flushed.
    notifyRendererReady();
    return () => {
      ipcRenderer.off("oneaction:capture-item", listener);
    };
  },

  /**
   * Register a handler for files dropped on the dock icon, opened via the
   * OS "Open With" menu, or passed on the command line (PDF / EPUB).
   * The main process reads the bytes and forwards them here.
   */
  onCaptureFile(handler: CaptureFileHandler): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: CaptureItemPayload,
    ) => {
      if (payload.kind === "file") {
        handler({
          id: payload.id,
          name: payload.name,
          mimeType: payload.mimeType,
          size: payload.size,
          bytes: payload.bytes,
        });
      }
    };
    ipcRenderer.on("oneaction:capture-item", listener);
    notifyRendererReady();
    return () => {
      ipcRenderer.off("oneaction:capture-item", listener);
    };
  },

  /**
   * Register one handler for both URL and file captures. Prefer this for new
   * renderer code because each payload includes a stable local outbox id.
   */
  onCaptureItem(handler: CaptureItemHandler): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: CaptureItemPayload,
    ) => {
      handler(payload);
    };
    ipcRenderer.on("oneaction:capture-item", listener);
    notifyRendererReady();
    return () => {
      ipcRenderer.off("oneaction:capture-item", listener);
    };
  },

  getCaptureOutbox(): Promise<CaptureOutboxItem[]> {
    return ipcRenderer.invoke("oneaction:get-capture-outbox");
  },

  getSyncStatus(): Promise<SyncStatus> {
    return ipcRenderer.invoke("oneaction:get-sync-status");
  },

  markCaptureSynced(id: string): Promise<CaptureOutboxItem[]> {
    return ipcRenderer.invoke("oneaction:mark-capture-synced", id);
  },

  removeCaptureOutboxItem(id: string): Promise<CaptureOutboxItem[]> {
    return ipcRenderer.invoke("oneaction:remove-capture-outbox-item", id);
  },

  redeliverCaptureOutboxItem(id: string): Promise<boolean> {
    return ipcRenderer.invoke("oneaction:redeliver-capture-outbox-item", id);
  },

  openCaptureOutboxItem(id: string): Promise<boolean> {
    return ipcRenderer.invoke("oneaction:open-capture-outbox-item", id);
  },

  captureDroppedFiles(files: File[]): Promise<CaptureOutboxItem[]> {
    return captureDroppedFileList(files);
  },

  captureUrl(url: string): Promise<CaptureOutboxItem[]> {
    return ipcRenderer.invoke("oneaction:capture-url", url);
  },

  onFileDragChanged(handler: FileDragHandler): () => void {
    fileDragHandlers.add(handler);
    return () => {
      fileDragHandlers.delete(handler);
    };
  },

  onDroppedFilesCaptured(handler: CaptureOutboxHandler): () => void {
    droppedFilesCapturedHandlers.add(handler);
    return () => {
      droppedFilesCapturedHandlers.delete(handler);
    };
  },

  onOpenOfflineQueue(handler: OpenQueueHandler): () => void {
    const listener = () => {
      handler();
    };
    ipcRenderer.on("oneaction:open-offline-queue", listener);
    return () => {
      ipcRenderer.off("oneaction:open-offline-queue", listener);
    };
  },

  retryAppLoad(): Promise<void> {
    return ipcRenderer.invoke("oneaction:retry-app-load");
  },

  onCaptureOutboxChanged(handler: CaptureOutboxHandler): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      items: CaptureOutboxItem[],
    ) => {
      handler(items);
    };
    ipcRenderer.on("oneaction:capture-outbox-changed", listener);
    return () => {
      ipcRenderer.off("oneaction:capture-outbox-changed", listener);
    };
  },

  onSyncStatusChanged(handler: SyncStatusHandler): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: SyncStatus,
    ) => {
      handler(status);
    };
    ipcRenderer.on("oneaction:sync-status-changed", listener);
    return () => {
      ipcRenderer.off("oneaction:sync-status-changed", listener);
    };
  },

  onRecoveryStatusChanged(handler: RecoveryStatusHandler): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: RecoveryStatus,
    ) => {
      handler(status);
    };
    ipcRenderer.on("oneaction:recovery-status-changed", listener);
    return () => {
      ipcRenderer.off("oneaction:recovery-status-changed", listener);
    };
  },
};

window.addEventListener("online", notifyNetworkStatus);
window.addEventListener("offline", notifyNetworkStatus);
window.addEventListener("dragover", (event) => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  emitFileDragState(true);
});
window.addEventListener("dragleave", (event) => {
  if (event.relatedTarget === null) emitFileDragState(false);
});
window.addEventListener("drop", async (event) => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  emitFileDragState(false);
  const items = await captureDroppedFileList(event.dataTransfer?.files ?? []);
  if (items.length > 0) emitDroppedFilesCaptured(items);
});
notifyNetworkStatus();

contextBridge.exposeInMainWorld("oneactionDesktop", api);

export type OneActionDesktopApi = typeof api;
