const MAX_FORMAT_ENTRIES = 512
const MAX_SVG_ENTRIES = 128
const MAX_SVG_CHARACTERS = 2_000_000

const formatCache = new Map<string, boolean>()
const svgCache = new Map<string, string>()
let svgCharacterCount = 0

export function getCachedAvatarFormat(uri: string) {
  return touch(formatCache, uri)
}

export function setCachedAvatarFormat(uri: string, isSvg: boolean) {
  setLru(formatCache, uri, isSvg, MAX_FORMAT_ENTRIES)
}

export function getCachedAvatarSvg(uri: string) {
  return touch(svgCache, uri)
}

export function setCachedAvatarSvg(uri: string, xml: string) {
  const previous = svgCache.get(uri)
  if (previous) svgCharacterCount -= previous.length

  svgCache.delete(uri)
  svgCache.set(uri, xml)
  svgCharacterCount += xml.length

  while (
    svgCache.size > MAX_SVG_ENTRIES ||
    svgCharacterCount > MAX_SVG_CHARACTERS
  ) {
    const oldestKey = svgCache.keys().next().value
    if (oldestKey === undefined) break
    const oldest = svgCache.get(oldestKey)
    if (oldest) svgCharacterCount -= oldest.length
    svgCache.delete(oldestKey)
  }
}

export function clearAvatarRenderCache() {
  formatCache.clear()
  svgCache.clear()
  svgCharacterCount = 0
}

function touch<T>(cache: Map<string, T>, key: string) {
  const value = cache.get(key)
  if (value === undefined) return undefined
  cache.delete(key)
  cache.set(key, value)
  return value
}

function setLru<T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  maxEntries: number
) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
}
