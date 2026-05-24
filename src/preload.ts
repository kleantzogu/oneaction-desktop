import { contextBridge, ipcRenderer } from "electron";

type CaptureHandler = (url: string) => void;

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
};

contextBridge.exposeInMainWorld("oneactionDesktop", api);

export type OneActionDesktopApi = typeof api;
