export function isSvgUrl(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized.startsWith("data:image/svg+xml")) return true

  try {
    return new URL(value).pathname.toLowerCase().endsWith(".svg")
  } catch {
    return value.split(/[?#]/, 1)[0]?.toLowerCase().endsWith(".svg") ?? false
  }
}

export function isSvgContent(value: string) {
  return /<svg(?:\s|>)/i.test(value.replace(/^\uFEFF/, "").slice(0, 8192))
}

export function normalizeAvatarSvgContent(value: string) {
  const root = /<svg(?:\s[^>]*)?>/i.exec(value)
  if (!root || /\bviewBox\s*=/i.test(root[0])) return value

  const width = getSvgLength(root[0], "width")
  const height = getSvgLength(root[0], "height")
  if (width === null || height === null) return value

  const insertionIndex = root.index + root[0].length - 1
  return `${value.slice(0, insertionIndex)} viewBox="0 0 ${width} ${height}"${value.slice(insertionIndex)}`
}

function getSvgLength(root: string, attribute: "height" | "width") {
  const match = new RegExp(
    `\\b${attribute}\\s*=\\s*(["'])([^"']+)\\1`,
    "i"
  ).exec(root)
  if (!match?.[2]) return null

  const length = /^\s*(\d*\.?\d+(?:e[-+]?\d+)?)\s*(?:px|pt|pc|mm|cm|in)?\s*$/i.exec(
    match[2]
  )
  const value = Number(length?.[1])
  return Number.isFinite(value) && value > 0 ? value : null
}
