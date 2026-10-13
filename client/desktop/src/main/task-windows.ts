import { BrowserWindow, screen, type WebContents } from "electron"
import { DESKTOP_CHANNELS, type ContentZoom, type ThemePreference } from "../shared/desktop"
import {
  TASK_WINDOW_CHANNELS,
  type TaskWindowChange,
  type TaskWindowContext,
} from "../shared/task-window"
import { AuthFailure } from "../shared/auth"
import { parseTaskWindowOpenInput } from "./task-window-policy"
import { centerWindowWithinWorkArea } from "./window-position"

export class TaskWindows {
  private readonly windows = new Map<
    WebContents,
    { window: BrowserWindow; context: TaskWindowContext }
  >()

  constructor(
    private readonly preloadPath: string,
    private readonly rendererPath: string,
    private readonly developmentUrl: string | undefined,
    private readonly getMainWindow: () => BrowserWindow | null,
    private readonly getZoom: () => ContentZoom,
    private readonly iconPath: string,
  ) {}

  async open(input: unknown) {
    const context = parseTaskWindowOpenInput(input)
    const main = this.getMainWindow()
    if (!main || main.isDestroyed()) throw new AuthFailure("window_unavailable", "主窗口不可用")
    const mainBounds = main.getBounds()
    const workArea = screen.getDisplayMatching(mainBounds).workArea
    const bounds = centerWindowWithinWorkArea(mainBounds, workArea, { width: 1024, height: 768 })
    const offset = Math.min(this.windows.size, 5) * 32
    bounds.x = Math.min(workArea.x + workArea.width - bounds.width, bounds.x + offset)
    bounds.y = Math.min(workArea.y + workArea.height - bounds.height, bounds.y + offset)
    const title = context.taskId ? "任务详情" : "创建任务"
    const window = new BrowserWindow({
      ...bounds,
      minWidth: Math.min(520, bounds.width),
      minHeight: Math.min(480, bounds.height),
      title,
      icon: this.iconPath,
      ...(process.platform === "darwin"
        ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 8, y: 9 } }
        : { frame: false }),
      backgroundColor: "#f8f9fb",
      show: false,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })
    const contents = window.webContents
    this.windows.set(contents, { window, context })
    contents.setZoomFactor(this.getZoom())
    window.webContents.on("did-finish-load", () => window.webContents.setZoomFactor(this.getZoom()))
    window.removeMenu()
    window.once("ready-to-show", () => window.show())
    window.on("closed", () => this.windows.delete(contents))
    const sendMaximizedState = () => {
      if (!window.isDestroyed())
        window.webContents.send(DESKTOP_CHANNELS.windowMaximizedChanged, window.isMaximized())
    }
    window.on("maximize", sendMaximizedState)
    window.on("unmaximize", sendMaximizedState)
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    window.webContents.on("will-navigate", (event) => event.preventDefault())

    try {
      const url = this.developmentUrl ? new URL(this.developmentUrl) : null
      if (url) {
        if (url.origin !== "http://127.0.0.1:20110") {
          throw new AuthFailure("untrusted_renderer", "开发页面地址不受信任")
        }
        url.hash = "/task-window"
        await window.loadURL(url.href)
      } else {
        await window.loadFile(this.rendererPath, { hash: "/task-window" })
      }
    } catch (error) {
      if (!window.isDestroyed()) window.destroy()
      throw error
    }
  }

  getContext(sender: WebContents): TaskWindowContext {
    const entry = this.windows.get(sender)
    if (!entry || entry.window.isDestroyed()) {
      throw new AuthFailure("untrusted_sender", "任务窗口请求来源不受信任")
    }
    return entry.context
  }

  ownsSender(sender: WebContents): boolean {
    return this.windows.has(sender) && !this.windows.get(sender)!.window.isDestroyed()
  }

  notifyChanged(sender: WebContents): TaskWindowChange {
    const { targetId, projectId } = this.getContext(sender)
    const change = { targetId, projectId }
    this.getMainWindow()?.webContents.send(TASK_WINDOW_CHANNELS.changed, change)
    for (const [contents] of this.windows) {
      if (contents !== sender && !contents.isDestroyed())
        contents.send(TASK_WINDOW_CHANNELS.changed, change)
    }
    return change
  }

  notifyThemeChanged(theme: ThemePreference) {
    for (const [contents] of this.windows) {
      if (!contents.isDestroyed()) contents.send(TASK_WINDOW_CHANNELS.themeChanged, theme)
    }
  }

  setZoom(zoom: ContentZoom) {
    for (const [contents] of this.windows) {
      if (!contents.isDestroyed()) contents.setZoomFactor(zoom)
    }
  }

  closeAll() {
    for (const { window } of this.windows.values()) if (!window.isDestroyed()) window.destroy()
    this.windows.clear()
  }
}
