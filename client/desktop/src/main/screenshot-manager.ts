import {
  BrowserWindow,
  clipboard,
  desktopCapturer,
  nativeImage,
  screen,
  type NativeImage,
  type WebContents,
} from "electron"
import { AuthFailure } from "../shared/auth"
import {
  SCREENSHOT_CHANNELS,
  type ScreenshotPayload,
  type ScreenshotSelection,
} from "../shared/screenshot"
import { validEditedPng, validScreenshotSelection } from "./screenshot-policy"
import { matchScreenshotSources } from "./screenshot-sources"
import { captureWindowsDisplays } from "./screenshot-windows"

export class ScreenshotManager {
  private readonly overlays = new Map<
    WebContents,
    { window: BrowserWindow; image: NativeImage; payload: ScreenshotPayload }
  >()
  private generation = 0
  private activeSender: WebContents | null = null
  private finishSession: (() => void) | null = null

  constructor(
    private readonly preloadPath: string,
    private readonly rendererPath: string,
    private readonly developmentUrl?: string,
  ) {}

  async capture() {
    this.destroyOverlays()
    const generation = this.generation
    const displays = screen.getAllDisplays()
    const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const windowsCapture = await captureWindowsDisplays(displays)
    if (generation !== this.generation) return
    let images: NativeImage[]
    if (process.platform === "win32" && windowsCapture.pngs.size === displays.length) {
      images = displays.map((display) =>
        nativeImage.createFromBuffer(windowsCapture.pngs.get(display.id)!),
      )
    } else {
      const thumbnailSize = {
        width: Math.max(
          1,
          ...displays.map((display) => Math.round(display.bounds.width * display.scaleFactor)),
        ),
        height: Math.max(
          1,
          ...displays.map((display) => Math.round(display.bounds.height * display.scaleFactor)),
        ),
      }
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize,
        fetchWindowIcons: false,
      })
      if (generation !== this.generation) return
      const matched = matchScreenshotSources(displays, sources)
      if (!matched) {
        const displayIds = displays.map((display) => display.id).join(",")
        const sourceIds = sources.map((source) => source.display_id || "空").join(",")
        throw new AuthFailure(
          "screenshot_unavailable",
          `屏幕对应失败（显示器 ID：${displayIds || "无"}；截图 ID：${sourceIds || "无"}）`,
        )
      }
      images = matched.map((source) => source.thumbnail)
    }
    const emptyIndex = images.findIndex((image) => image.isEmpty())
    if (emptyIndex >= 0) {
      throw new AuthFailure("screenshot_unavailable", `第 ${emptyIndex + 1} 块屏幕返回空画面`)
    }

    try {
      const windows = displays.map((display, index) => {
        const image = images[index]
        const imageSize = image.getSize()
        const capturedPng = windowsCapture.pngs.get(display.id)
        const payload: ScreenshotPayload = {
          imageUrl: capturedPng
            ? `data:image/png;base64,${capturedPng.toString("base64")}`
            : image.toDataURL(),
          imageWidth: imageSize.width,
          imageHeight: imageSize.height,
          windows: windowsCapture.windows.get(display.id) ?? [],
        }
        const window = new BrowserWindow({
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
          frame: false,
          show: false,
          enableLargerThanScreen: process.platform === "darwin",
          fullscreen: process.platform === "win32",
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: process.platform === "win32",
          skipTaskbar: process.platform !== "darwin",
          alwaysOnTop: true,
          backgroundColor: "#000000",
          webPreferences: {
            preload: this.preloadPath,
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
          },
        })
        const webContents = window.webContents
        this.overlays.set(webContents, { window, image, payload })
        window.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
          // 避免 Electron 将整个 macOS 应用切换为不显示 Dock 的辅助进程。
          skipTransformProcessType: process.platform === "darwin",
        })
        window.setAlwaysOnTop(true, "screen-saver")
        window.removeMenu()
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
        window.webContents.on("will-navigate", (event) => event.preventDefault())
        window.on("closed", () => {
          if (this.overlays.has(webContents)) this.destroyOverlays()
        })
        return { window, displayId: display.id, bounds: display.bounds }
      })
      await Promise.all(
        windows.map(({ window }) => {
          if (this.developmentUrl) {
            const url = new URL(this.developmentUrl)
            url.hash = "/screenshot"
            return window.loadURL(url.href)
          }
          return window.loadFile(this.rendererPath, { hash: "/screenshot" })
        }),
      )
      if (generation !== this.generation) return
      for (const { window, bounds } of windows) {
        window.showInactive()
        if (process.platform === "darwin") {
          window.setBounds(bounds)
          const initial = window.getBounds()
          let attempted: typeof initial | undefined
          if (
            initial.x === bounds.x &&
            initial.width === bounds.width &&
            initial.height === bounds.height &&
            initial.y > bounds.y
          ) {
            // 部分 macOS 环境会把 y=0 强制下移一个菜单栏高度；尝试抵消这次偏移。
            const requested = { ...bounds, y: bounds.y - (initial.y - bounds.y) }
            try {
              window.setBounds(requested)
              attempted = window.getBounds()
              if (attempted.y !== bounds.y) window.setBounds(bounds)
            } catch {
              window.setBounds(bounds)
            }
          }
          const actual = window.getBounds()
          if (
            actual.x !== bounds.x ||
            actual.y !== bounds.y ||
            actual.width !== bounds.width ||
            actual.height !== bounds.height
          ) {
            console.warn("macOS 截图遮罩未覆盖整个显示器", {
              expected: bounds,
              initial,
              attempted,
              actual,
            })
          }
        }
      }
      const focusedWindow = windows.find(({ displayId }) => displayId === cursorDisplay.id)?.window
      const windowToFocus = focusedWindow ?? windows[0]?.window
      if (windowToFocus) windowToFocus.focus()
      await new Promise<void>((resolve) => {
        if (generation !== this.generation) resolve()
        else this.finishSession = resolve
      })
    } catch (error) {
      if (generation === this.generation) this.destroyOverlays()
      throw error
    }
  }

  getPayload(sender: WebContents): ScreenshotPayload {
    const overlay = this.overlays.get(sender)
    if (!overlay || overlay.window.isDestroyed()) {
      throw new AuthFailure("screenshot_unavailable", "截图画面尚未准备完成")
    }
    return overlay.payload
  }

  ownsSender(sender: WebContents): boolean {
    const overlay = this.overlays.get(sender)
    return Boolean(overlay && !overlay.window.isDestroyed())
  }

  activate(sender: WebContents) {
    if (!this.ownsSender(sender)) {
      throw new AuthFailure("invalid_screenshot_selection", "截图窗口已关闭")
    }
    if (this.activeSender === sender) return
    this.activeSender = sender
    for (const [other, overlay] of this.overlays) {
      if (other !== sender && !overlay.window.isDestroyed()) {
        other.send(SCREENSHOT_CHANNELS.resetSelection)
      }
    }
  }

  complete(sender: WebContents, selection: ScreenshotSelection) {
    const overlay = this.overlays.get(sender)
    if (
      this.activeSender !== sender ||
      !overlay ||
      overlay.window.isDestroyed() ||
      !validScreenshotSelection(selection)
    ) {
      throw new AuthFailure("invalid_screenshot_selection", "截图区域不正确")
    }
    const image = overlay.image
    const size = image.getSize()
    const scaleX = size.width / selection.viewportWidth
    const scaleY = size.height / selection.viewportHeight
    const x = clamp(Math.round(selection.x * scaleX), 0, size.width - 1)
    const y = clamp(Math.round(selection.y * scaleY), 0, size.height - 1)
    const width = clamp(Math.round(selection.width * scaleX), 1, size.width - x)
    const height = clamp(Math.round(selection.height * scaleY), 1, size.height - y)
    if (selection.editedPng !== undefined) {
      if (
        !validEditedPng(selection.editedPng) ||
        new DataView(selection.editedPng).getUint32(16) !== width ||
        new DataView(selection.editedPng).getUint32(20) !== height
      ) {
        throw new AuthFailure("invalid_screenshot_selection", "截图标注数据不正确")
      }
      const edited = nativeImage.createFromBuffer(Buffer.from(selection.editedPng))
      const editedSize = edited.getSize()
      if (edited.isEmpty() || editedSize.width !== width || editedSize.height !== height) {
        throw new AuthFailure("invalid_screenshot_selection", "截图标注尺寸不正确")
      }
      clipboard.writeImage(edited)
    } else {
      const cropped = image.crop({ x, y, width, height })
      if (cropped.isEmpty()) throw new AuthFailure("screenshot_failed", "截图区域为空")
      clipboard.writeImage(cropped)
    }
    this.destroyOverlays()
  }

  cancel() {
    this.destroyOverlays()
  }

  close() {
    this.destroyOverlays()
  }

  private destroyOverlays() {
    this.generation += 1
    this.activeSender = null
    this.finishSession?.()
    this.finishSession = null
    const overlays = Array.from(this.overlays.values())
    this.overlays.clear()
    for (const { window } of overlays) {
      if (!window.isDestroyed()) window.destroy()
    }
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
