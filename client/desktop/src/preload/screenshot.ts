import { contextBridge, ipcRenderer } from "electron"
import { SCREENSHOT_CHANNELS, type ScreenshotBridge } from "../shared/screenshot"

const bridge: ScreenshotBridge = {
  initialize: () => ipcRenderer.invoke(SCREENSHOT_CHANNELS.initialize),
  activate: () => ipcRenderer.invoke(SCREENSHOT_CHANNELS.activate),
  onResetSelection: (callback) => {
    const listener = () => callback()
    ipcRenderer.on(SCREENSHOT_CHANNELS.resetSelection, listener)
    return () => ipcRenderer.removeListener(SCREENSHOT_CHANNELS.resetSelection, listener)
  },
  complete: (selection) => ipcRenderer.invoke(SCREENSHOT_CHANNELS.complete, selection),
  cancel: () => ipcRenderer.invoke(SCREENSHOT_CHANNELS.cancel),
}

contextBridge.exposeInMainWorld("screenshot", bridge)
