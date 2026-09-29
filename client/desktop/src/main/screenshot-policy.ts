import type { ScreenshotSelection } from "../shared/screenshot"

export function validScreenshotSelection(value: ScreenshotSelection): boolean {
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

export function validEditedPng(value: unknown): value is ArrayBuffer {
  if (
    !(value instanceof ArrayBuffer) ||
    value.byteLength < 24 ||
    value.byteLength > 32 * 1024 * 1024
  ) {
    return false
  }
  const bytes = new Uint8Array(value)
  const header = new DataView(value)
  return (
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) &&
    header.getUint32(8) === 13 &&
    bytes[12] === 73 &&
    bytes[13] === 72 &&
    bytes[14] === 68 &&
    bytes[15] === 82
  )
}
