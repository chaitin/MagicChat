import type { DesktopBridge } from "../shared/desktop"
import type { MediaPreviewBridge } from "../shared/media"
import type { ScreenshotBridge } from "../shared/screenshot"

declare global {
  interface Window {
    desktop?: DesktopBridge
    screenshot?: ScreenshotBridge
    mediaPreview?: MediaPreviewBridge
  }
}
