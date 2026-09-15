export const SCREENSHOT_CHANNELS = {
  initialize: "desktop-next:v1:screenshot-initialize",
  complete: "desktop-next:v1:screenshot-complete",
  cancel: "desktop-next:v1:screenshot-cancel",
} as const

export type ScreenshotPayload = {
  imageUrl: string
  imageWidth: number
  imageHeight: number
}

export type ScreenshotSelection = {
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
}

export interface ScreenshotBridge {
  initialize(): Promise<ScreenshotPayload>
  complete(selection: ScreenshotSelection): Promise<void>
  cancel(): Promise<void>
}
