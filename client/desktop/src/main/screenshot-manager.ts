import {
  BrowserWindow,
  clipboard,
  desktopCapturer,
  screen,
  type NativeImage,
  type WebContents,
} from "electron"
import { AuthFailure } from "../shared/auth"
import type { ScreenshotPayload, ScreenshotSelection } from "../shared/screenshot"

export class ScreenshotManager {
  private overlay: BrowserWindow | null = null
  private image: NativeImage | null = null
  private payload: ScreenshotPayload | null = null

  constructor(
    private readonly preloadPath: string,
    private readonly rendererPath: string,
    private readonly developmentUrl?: string,
  ) {}

  async capture() {
    this.destroyOverlay()
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const thumbnailSize = {
      width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
      height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor)),
    }
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize,
      fetchWindowIcons: false,
    })
    const source =
      sources.find((candidate) => candidate.display_id === String(display.id)) ??
      (sources.length === 1 ? sources[0] : undefined)
    if (!source || source.thumbnail.isEmpty()) {
      throw new AuthFailure("screenshot_unavailable", "无法获取当前屏幕画面")
    }

    this.image = source.thumbnail
    const imageSize = this.image.getSize()
    const payload: ScreenshotPayload = {
      imageUrl: this.image.toDataURL(),
      imageWidth: imageSize.width,
      imageHeight: imageSize.height,
    }
    this.payload = payload
    const overlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
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
    this.overlay = overlay
    overlay.setAlwaysOnTop(true, "screen-saver")
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    overlay.removeMenu()
    overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    overlay.webContents.on("will-navigate", (event) => event.preventDefault())
    overlay.on("closed", () => {
      if (this.overlay === overlay) {
        this.overlay = null
        this.image = null
        this.payload = null
      }
    })
    overlay.webContents.once("did-finish-load", () => {
      if (this.overlay !== overlay || overlay.isDestroyed()) return
      overlay.show()
      overlay.focus()
    })

    if (this.developmentUrl) {
      const url = new URL(this.developmentUrl)
      url.hash = "/screenshot"
      await overlay.loadURL(url.href)
    } else {
      await overlay.loadFile(this.rendererPath, { hash: "/screenshot" })
    }
  }

  getPayload(): ScreenshotPayload {
    if (!this.payload) throw new AuthFailure("screenshot_unavailable", "截图画面尚未准备完成")
    return this.payload
  }

  ownsSender(sender: WebContents): boolean {
    return Boolean(
      this.overlay && !this.overlay.isDestroyed() && this.overlay.webContents === sender,
    )
  }

  complete(selection: ScreenshotSelection) {
    const image = this.image
    if (!image || !validSelection(selection)) {
      throw new AuthFailure("invalid_screenshot_selection", "截图区域不正确")
    }
    const size = image.getSize()
    const scaleX = size.width / selection.viewportWidth
    const scaleY = size.height / selection.viewportHeight
    const x = clamp(Math.round(selection.x * scaleX), 0, size.width - 1)
    const y = clamp(Math.round(selection.y * scaleY), 0, size.height - 1)
    const width = clamp(Math.round(selection.width * scaleX), 1, size.width - x)
    const height = clamp(Math.round(selection.height * scaleY), 1, size.height - y)
    const cropped = image.crop({ x, y, width, height })
    if (cropped.isEmpty()) throw new AuthFailure("screenshot_failed", "截图区域为空")
    clipboard.writeImage(cropped)
    this.destroyOverlay()
  }

  cancel() {
    this.destroyOverlay()
  }

  close() {
    this.destroyOverlay()
  }

  private destroyOverlay() {
    const overlay = this.overlay
    this.overlay = null
    this.image = null
    this.payload = null
    if (overlay && !overlay.isDestroyed()) overlay.destroy()
  }
}

function validSelection(value: ScreenshotSelection): boolean {
  return (
    value != null &&
    [value.x, value.y, value.width, value.height, value.viewportWidth, value.viewportHeight].every(
      (part) => typeof part === "number" && Number.isFinite(part),
    ) &&
    value.x >= 0 &&
    value.y >= 0 &&
    value.width >= 2 &&
    value.height >= 2 &&
    value.viewportWidth > 0 &&
    value.viewportHeight > 0 &&
    value.x + value.width <= value.viewportWidth + 1 &&
    value.y + value.height <= value.viewportHeight + 1
  )
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
