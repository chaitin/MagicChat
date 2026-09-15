import { contextBridge, ipcRenderer } from "electron"
import { SCREENSHOT_CHANNELS, type ScreenshotBridge } from "../shared/screenshot"

const bridge: ScreenshotBridge = {
  initialize: () => ipcRenderer.invoke(SCREENSHOT_CHANNELS.initialize),
  complete: (selection) => ipcRenderer.invoke(SCREENSHOT_CHANNELS.complete, selection),
  cancel: () => ipcRenderer.invoke(SCREENSHOT_CHANNELS.cancel),
}

contextBridge.exposeInMainWorld("screenshot", bridge)
