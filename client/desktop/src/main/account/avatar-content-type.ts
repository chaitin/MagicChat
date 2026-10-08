export const AVATAR_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/avif",
  "image/webp",
  "image/gif",
  "image/svg+xml",
])

export const AVATAR_ACCEPT = [...AVATAR_CONTENT_TYPES].join(",")

export function detectAvatarContentType(bytes: Uint8Array): string | undefined {
  if (bytes.byteLength === 0) return undefined
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    return "image/png"
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  const decoder = new TextDecoder()
  const signature = decoder.decode(bytes.subarray(0, 12))
  if (bytes.byteLength >= 16 && /^ftypavi[fs]$/.test(signature.slice(4, 12))) {
    return "image/avif"
  }
  if (signature.startsWith("GIF87a") || signature.startsWith("GIF89a")) return "image/gif"
  if (signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP") return "image/webp"
  const source = decoder.decode(bytes.subarray(0, 32 * 1_024))
  if (
    /<svg(?:\s|>)/i.test(source) &&
    !/<script(?:\s|>)/i.test(source) &&
    !/<foreignObject(?:\s|>)/i.test(source) &&
    !/\son[a-z]+\s*=/i.test(source) &&
    !/(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i.test(source)
  ) {
    return "image/svg+xml"
  }
  return undefined
}

export function avatarExtensionFor(contentType: string): string {
  return (
    {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/avif": "avif",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/svg+xml": "svg",
    }[contentType] ?? "png"
  )
}
