export function normalizeSingleLinkMessageURL(content: string) {
  const value = content.trim()
  if (!value || /\s/.test(value)) return null
  const candidate = value.toLowerCase().startsWith("www.") ? `https://${value}` : value
  try {
    const url = new URL(candidate)
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null
    return url.toString()
  } catch {
    return null
  }
}
