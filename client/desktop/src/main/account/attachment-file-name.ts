import path from "node:path"

const MAX_FILE_NAME_BYTES = 255

export function numberedAttachmentFileName(originalName: string, index: number) {
  const parsed = path.parse(originalName)
  const suffix = index <= 0 ? "" : `.${index}`
  const extension = truncateUtf8(parsed.ext, 32)
  const reservedBytes = Buffer.byteLength(suffix) + Buffer.byteLength(extension)
  const name = truncateUtf8(parsed.name, Math.max(1, MAX_FILE_NAME_BYTES - reservedBytes)) || "附件"
  return `${name}${suffix}${extension}`
}

function truncateUtf8(value: string, maxBytes: number) {
  let result = ""
  let bytes = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character)
    if (bytes + characterBytes > maxBytes) break
    result += character
    bytes += characterBytes
  }
  return result
}
