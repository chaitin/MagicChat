export const selectionLifetimeMs = 10 * 60_000

export function isSelectionExpired(selectedAt: number, now = Date.now()) {
  return now - selectedAt > selectionLifetimeMs
}

export function mediaContentType(category: "image" | "video", extension: string) {
  if (category === "image") {
    if (extension === ".png") return "image/png"
    if (extension === ".webp") return "image/webp"
    if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg"
    return ""
  }
  if (extension === ".webm") return "video/webm"
  if (extension === ".mp4") return "video/mp4"
  return ""
}

export function detectImageContentType(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png" as const
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg" as const
  }
  if (bytes.length >= 12 && ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
    return "image/webp" as const
  }
  return undefined
}

function ascii(bytes: Uint8Array, offset: number, value: string) {
  return Array.from(value).every(
    (character, index) => bytes[offset + index] === character.charCodeAt(0),
  )
}
