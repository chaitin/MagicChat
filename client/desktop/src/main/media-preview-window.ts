import { BrowserWindow, type WebContents } from "electron"
import { DESKTOP_CHANNELS, type ThemePreference } from "../shared/desktop"
import { MEDIA_CHANNELS, type MediaPreviewPayload } from "../shared/media"
import { AuthFailure } from "../shared/auth"

export type MediaPreviewSource =
  | { targetId: string; kind: "cached"; cacheKey: string }
  | { targetId: string; kind: "outgoing"; clientMessageId: string }
  | { targetId: string; kind: "avatar"; resourceKey: string }

export class MediaPreviewWindow {
  private window: BrowserWindow | null = null
  private payload: MediaPreviewPayload | null = null
  private source: MediaPreviewSource | null = null

  constructor(
    private readonly preloadPath: string,
    private readonly rendererPath: string,
    private readonly developmentUrl?: string,
  ) {}

  open(payload: MediaPreviewPayload, source: MediaPreviewSource) {
    this.payload = payload
    this.source = source
    const windowTitle = `即应 Chat - ${payload.title}`
    if (this.window && !this.window.isDestroyed()) {
      this.window.setTitle(windowTitle)
      this.window.webContents.send(MEDIA_CHANNELS.previewChanged, payload)
      if (this.window.isMinimized()) this.window.restore()
      this.window.show()
      this.window.focus()
      return
    }

    const window = new BrowserWindow({
      width: 960,
      height: 720,
      minWidth: 560,
      minHeight: 420,
      title: windowTitle,
      ...(process.platform === "darwin"
        ? {
            titleBarStyle: "hiddenInset" as const,
            trafficLightPosition: { x: 8, y: 9 },
          }
        : { frame: false }),
      backgroundColor: "#000000",
      show: false,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })
    this.window = window
    window.removeMenu()
    window.once("ready-to-show", () => window.show())
    window.on("closed", () => {
      if (this.window === window) this.window = null
    })
    const sendMaximizedState = () => {
      if (!window.isDestroyed()) {
        window.webContents.send(DESKTOP_CHANNELS.windowMaximizedChanged, window.isMaximized())
      }
    }
    window.on("maximize", sendMaximizedState)
    window.on("unmaximize", sendMaximizedState)
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    window.webContents.on("will-navigate", (event) => event.preventDefault())

    if (this.developmentUrl) {
      const url = new URL(this.developmentUrl)
      if (url.origin !== "http://127.0.0.1:20110") throw new Error("开发页面地址不受信任")
      url.hash = "/media-preview"
      void window.loadURL(url.href)
    } else {
      void window.loadFile(this.rendererPath, { hash: "/media-preview" })
    }
  }

  notifyThemeChanged(theme: ThemePreference) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(MEDIA_CHANNELS.previewThemeChanged, theme)
    }
  }

  getPayload(sender: WebContents) {
    if (!this.ownsSender(sender) || !this.payload) {
      throw new AuthFailure("preview_unavailable", "媒体预览内容不可用")
    }
    return this.payload
  }

  getSource(sender: WebContents) {
    if (!this.ownsSender(sender) || !this.source) {
      throw new AuthFailure("preview_unavailable", "媒体预览内容不可用")
    }
    return this.source
  }

  ownsSender(sender: WebContents) {
    return Boolean(this.window && !this.window.isDestroyed() && sender === this.window.webContents)
  }

  close() {
    this.window?.destroy()
    this.window = null
    this.payload = null
    this.source = null
  }
}
