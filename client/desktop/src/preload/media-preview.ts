import { contextBridge, ipcRenderer } from "electron"
import type { DesktopPlatform } from "../shared/desktop"
import type { MediaPreviewBridge, MediaPreviewPayload } from "../shared/media"

// Keep this preload self-contained: sandboxed Electron preloads cannot load Rollup shared chunks.
const WINDOW_CHANNELS = {
  getState: "desktop-next:v1:window-get-state",
  minimize: "desktop-next:v1:window-minimize",
  toggleMaximize: "desktop-next:v1:window-toggle-maximize",
  close: "desktop-next:v1:window-close",
  maximizedChanged: "desktop-next:v1:window-maximized-changed",
} as const

const PREVIEW_CHANNELS = {
  initialize: "desktop-next:v1:media-preview-initialize",
  changed: "desktop-next:v1:media-preview-changed",
} as const

const platform: DesktopPlatform =
  process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"

const bridge: MediaPreviewBridge = {
  initialize: () => ipcRenderer.invoke(PREVIEW_CHANNELS.initialize),
  onChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MediaPreviewPayload) =>
      callback(payload)
    ipcRenderer.on(PREVIEW_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(PREVIEW_CHANNELS.changed, listener)
  },
  windowControls: {
    platform,
    getMaximized: () => ipcRenderer.invoke(WINDOW_CHANNELS.getState),
    minimize: () => ipcRenderer.invoke(WINDOW_CHANNELS.minimize),
    toggleMaximize: () => ipcRenderer.invoke(WINDOW_CHANNELS.toggleMaximize),
    close: () => ipcRenderer.invoke(WINDOW_CHANNELS.close),
    onMaximizedChange: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
        callback(maximized)
      ipcRenderer.on(WINDOW_CHANNELS.maximizedChanged, listener)
      return () => ipcRenderer.removeListener(WINDOW_CHANNELS.maximizedChanged, listener)
    },
  },
}

contextBridge.exposeInMainWorld("mediaPreview", bridge)
