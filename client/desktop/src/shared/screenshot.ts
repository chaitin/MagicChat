export const SCREENSHOT_CHANNELS = {
  initialize: "desktop-next:v1:screenshot-initialize",
  activate: "desktop-next:v1:screenshot-activate",
  resetSelection: "desktop-next:v1:screenshot-reset-selection",
  complete: "desktop-next:v1:screenshot-complete",
  cancel: "desktop-next:v1:screenshot-cancel",
} as const

export type ScreenshotWindowBounds = { x: number; y: number; width: number; height: number }

export type ScreenshotPayload = {
  imageUrl: string
  imageWidth: number
  imageHeight: number
  windows: ScreenshotWindowBounds[]
}

export type ScreenshotSelection = {
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  editedPng?: ArrayBuffer
}

export interface ScreenshotBridge {
  initialize(): Promise<ScreenshotPayload>
  activate(): Promise<void>
  onResetSelection(callback: () => void): () => void
  complete(selection: ScreenshotSelection): Promise<void>
  cancel(): Promise<void>
}
