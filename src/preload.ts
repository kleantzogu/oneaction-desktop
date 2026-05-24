import { contextBridge, ipcRenderer } from "electron";

type CaptureHandler = (url: string) => void;
type CaptureFilePayload = {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
};
type CaptureFileHandler = (file: CaptureFilePayload) => void;

const api = {
  /**
   * Register a handler for capture deep links sent from the main process
   * (e.g. `oneaction://save?url=...`). Returns a cleanup function that
   * removes the listener.
   */
  onCapture(handler: CaptureHandler): () => void {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => {
      handler(url);
    };
    ipcRenderer.on("oneaction:capture", listener);
    // Tell main we're ready so any deep links queued during startup get flushed.
    ipcRenderer.send("oneaction:renderer-ready");
    return () => {
      ipcRenderer.off("oneaction:capture", listener);
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
      payload: CaptureFilePayload,
    ) => {
      handler(payload);
    };
    ipcRenderer.on("oneaction:capture-file", listener);
    ipcRenderer.send("oneaction:renderer-ready");
    return () => {
      ipcRenderer.off("oneaction:capture-file", listener);
    };
  },
};

contextBridge.exposeInMainWorld("oneactionDesktop", api);

export type OneActionDesktopApi = typeof api;
