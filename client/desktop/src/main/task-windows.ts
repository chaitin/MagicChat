import { BrowserWindow, dialog, screen, type WebContents } from "electron"
import { DESKTOP_CHANNELS, type ContentZoom, type ThemePreference } from "../shared/desktop"
import {
  TASK_WINDOW_CHANNELS,
  type TaskWindowChange,
  type TaskWindowContext,
} from "../shared/task-window"
import { AuthFailure } from "../shared/auth"
import { parseTaskWindowOpenInput } from "./task-window-policy"
import { centerWindowWithinWorkArea } from "./window-position"
import { sendToRenderer } from "./renderer-messages"

type TaskWindowEntry = {
  window: BrowserWindow
  context: TaskWindowContext
  opening: Promise<void>
  initialize: () => void
  cancelOpening: () => void
}

export class TaskWindows {
  private readonly windows = new Map<WebContents, TaskWindowEntry>()

  constructor(
    private readonly preloadPath: string,
    private readonly rendererPath: string,
    private readonly developmentUrl: string | undefined,
    private readonly getMainWindow: () => BrowserWindow | null,
    private readonly getZoom: () => ContentZoom,
    private readonly iconPath: string,
    private readonly notifyMainChanged: (change: TaskWindowChange) => void,
  ) {}

  async open(input: unknown) {
    const context = parseTaskWindowOpenInput(input)
    if (context.taskId || context.view === "project") {
      for (const entry of this.windows.values()) {
        if (
          !entry.window.isDestroyed() &&
          entry.context.view === context.view &&
          entry.context.targetId === context.targetId &&
          entry.context.projectId === context.projectId &&
          entry.context.taskId === context.taskId
        ) {
          if (entry.window.isMinimized()) entry.window.restore()
          entry.window.show()
          entry.window.focus()
          return entry.opening
        }
      }
    }
    const url = this.developmentUrl ? new URL(this.developmentUrl) : null
    if (url && url.origin !== "http://127.0.0.1:20110") {
      throw new AuthFailure("untrusted_renderer", "开发页面地址不受信任")
    }
    if (url) url.hash = "/task-window"
    const main = this.getMainWindow()
    if (!main || main.isDestroyed()) throw new AuthFailure("window_unavailable", "主窗口不可用")
    const mainBounds = main.getBounds()
    const workArea = screen.getDisplayMatching(mainBounds).workArea
    const bounds = centerWindowWithinWorkArea(
      mainBounds,
      workArea,
      context.view === "project" ? { width: 1280, height: 900 } : { width: 1024, height: 768 },
    )
    const offset = Math.min(this.windows.size, 5) * 32
    bounds.x = Math.min(workArea.x + workArea.width - bounds.width, bounds.x + offset)
    bounds.y = Math.min(workArea.y + workArea.height - bounds.height, bounds.y + offset)
    const title =
      context.view === "project"
        ? context.projectName || "项目任务"
        : context.taskId
          ? "任务详情"
          : "创建任务"
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
      show: true,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })
    const contents = window.webContents
    let resolveOpening!: () => void
    let rejectOpening!: (error: Error) => void
    const opening = new Promise<void>((resolve, reject) => {
      resolveOpening = resolve
      rejectOpening = reject
    })
    let initialized = false
    let closed = false
    let failed = false
    const cancelOpening = () => {
      closed = true
      clearTimeout(startupTimer)
      resolveOpening()
    }
    const fail = (error: AuthFailure) => {
      if (closed || failed || window.isDestroyed()) return
      failed = true
      clearTimeout(startupTimer)
      rejectOpening(error)
      window.destroy()
      if (initialized) {
        const main = this.getMainWindow()
        if (main && !main.isDestroyed()) {
          void dialog
            .showMessageBox(main, {
              type: "error",
              title: "任务窗口异常",
              message: error.message,
              buttons: ["确定"],
            })
            .catch(() => undefined)
        }
      }
    }
    // 导航完成不代表 React 已启动，必须等任务页或错误页确认可交互。
    const startupTimer = setTimeout(
      () => fail(new AuthFailure("task_window_timeout", "任务窗口启动超时，请重新打开")),
      20_000,
    )
    this.windows.set(contents, {
      window,
      context,
      opening,
      initialize: () => {
        initialized = true
        clearTimeout(startupTimer)
        resolveOpening()
      },
      cancelOpening,
    })
    contents.setZoomFactor(this.getZoom())
    contents.on("did-finish-load", () => {
      if (!contents.isDestroyed()) contents.setZoomFactor(this.getZoom())
    })
    contents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3)
        fail(new AuthFailure("task_window_load_failed", "任务窗口页面加载失败，请重新打开"))
    })
    contents.on("preload-error", () =>
      fail(new AuthFailure("task_window_preload_failed", "任务窗口初始化失败，请重新打开")),
    )
    contents.on("render-process-gone", (_event, details) => {
      console.warn("任务窗口渲染进程退出", details.reason, details.exitCode)
      fail(new AuthFailure("task_window_renderer_gone", "任务窗口渲染异常，请重新打开"))
    })
    window.removeMenu()
    window.on("closed", () => {
      cancelOpening()
      this.windows.delete(contents)
    })
    const sendMaximizedState = () => {
      if (!window.isDestroyed())
        sendToRenderer(
          window.webContents,
          DESKTOP_CHANNELS.windowMaximizedChanged,
          window.isMaximized(),
        )
    }
    window.on("maximize", sendMaximizedState)
    window.on("unmaximize", sendMaximizedState)
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    window.webContents.on("will-navigate", (event) => event.preventDefault())

    try {
      const loading = url
        ? window.loadURL(url.href)
        : window.loadFile(this.rendererPath, { hash: "/task-window" })
      void loading.catch(() =>
        fail(new AuthFailure("task_window_load_failed", "任务窗口页面加载失败，请重新打开")),
      )
    } catch {
      fail(new AuthFailure("task_window_load_failed", "任务窗口页面加载失败，请重新打开"))
    }
    return opening
  }

  initialize(sender: WebContents): TaskWindowContext {
    const context = this.getContext(sender)
    this.windows.get(sender)!.initialize()
    return context
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
    this.notifyProjectChanged(change, sender)
    return change
  }

  notifyProjectChanged(change: TaskWindowChange, sender?: WebContents) {
    if (sender !== this.getMainWindow()?.webContents) this.notifyMainChanged(change)
    for (const [contents, entry] of this.windows) {
      if (
        contents !== sender &&
        !contents.isDestroyed() &&
        entry.context.targetId === change.targetId &&
        entry.context.projectId === change.projectId
      )
        sendToRenderer(contents, TASK_WINDOW_CHANNELS.changed, change)
    }
  }

  notifyThemeChanged(theme: ThemePreference) {
    for (const [contents] of this.windows) {
      sendToRenderer(contents, TASK_WINDOW_CHANNELS.themeChanged, theme)
    }
  }

  setZoom(zoom: ContentZoom) {
    for (const [contents] of this.windows) {
      if (!contents.isDestroyed()) contents.setZoomFactor(zoom)
    }
  }

  closeAll() {
    for (const entry of this.windows.values()) {
      entry.cancelOpening()
      if (!entry.window.isDestroyed()) entry.window.destroy()
    }
    this.windows.clear()
  }
}
