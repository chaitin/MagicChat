export const DESKTOP_VERSION_MANIFEST_URL = "https://jiying.chat/releases/version.json"

export type DesktopVersionKey = "linux-amd" | "linux-arm" | "macos" | "windows"

export type DesktopVersionEntry = Readonly<{
  build: number
  url: string
  version: string
}>

const officialPackagePaths: Readonly<Record<DesktopVersionKey, string>> = {
  "linux-amd": "/releases/jiying.amd.AppImage",
  "linux-arm": "/releases/jiying.arm.AppImage",
  macos: "/releases/jiying.dmg",
  windows: "/releases/jiying.exe",
}

export function selectDesktopVersionEntry(
  value: unknown,
  platform: NodeJS.Platform,
  arch: string,
): DesktopVersionEntry | undefined {
  const key = desktopVersionKey(platform, arch)
  if (!key) return undefined
  if (!isObject(value) || !(key in value)) throw new Error(`metadata missing ${key}`)
  return parseDesktopVersionEntry(value[key], key)
}

export function desktopVersionKey(
  platform: NodeJS.Platform,
  arch: string,
): DesktopVersionKey | undefined {
  if (platform === "win32") return arch === "x64" ? "windows" : undefined
  if (platform === "darwin") return arch === "x64" || arch === "arm64" ? "macos" : undefined
  if (platform === "linux") {
    if (arch === "x64") return "linux-amd"
    if (arch === "arm64") return "linux-arm"
  }
  return undefined
}

export function compareStableVersions(left: string, right: string): number {
  const leftParts = stableVersionParts(left)
  const rightParts = stableVersionParts(right)
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index]
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

export function isStableVersion(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
}

export function desktopPackageFileName(key: DesktopVersionKey, version: string): string {
  if (!isStableVersion(version)) throw new Error(`metadata invalid version: ${version}`)
  if (key === "windows") return `Jiying-${version}-win-x64.exe`
  if (key === "macos") return `Jiying-${version}-mac-universal.dmg`
  if (key === "linux-amd") return `Jiying-${version}-linux-x86_64.AppImage`
  return `Jiying-${version}-linux-arm64.AppImage`
}

export function isAllowedDesktopManifestUrl(value: string): boolean {
  const url = parseUrl(value)
  if (
    !url ||
    url.origin !== "https://jiying.chat" ||
    url.pathname !== "/releases/version.json" ||
    url.hash
  ) {
    return false
  }
  const keys = Array.from(url.searchParams.keys())
  return (
    keys.length === 0 ||
    (keys.length === 1 && keys[0] === "_" && /^\d+$/.test(url.searchParams.get("_") ?? ""))
  )
}

export function isAllowedDesktopPackageUrl(
  value: string,
  key: DesktopVersionKey,
  version: string,
): boolean {
  if (!isStableVersion(version)) return false
  const url = parseUrl(value)
  if (!url || url.hash || url.search) return false
  if (url.origin === "https://jiying.chat") {
    return url.pathname === officialPackagePaths[key]
  }
  if (url.origin !== "https://github.com") return false
  return (
    url.pathname ===
    `/ptonlix/MagicChat/releases/download/desktop-v${version}/${desktopPackageFileName(key, version)}`
  )
}

function parseDesktopVersionEntry(value: unknown, key: DesktopVersionKey): DesktopVersionEntry {
  if (!isObject(value)) throw new Error(`metadata invalid ${key}`)
  const { build, url, version } = value
  if (!Number.isSafeInteger(build) || (build as number) <= 0) {
    throw new Error(`metadata invalid ${key} build`)
  }
  if (!isStableVersion(version)) throw new Error(`metadata invalid ${key} version`)
  if (typeof url !== "string" || !isAllowedDesktopPackageUrl(url, key, version)) {
    throw new Error(`metadata invalid ${key} url`)
  }
  return {
    build: build as number,
    url,
    version,
  }
}

function parseUrl(value: string): URL | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined
  return url
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stableVersionParts(value: string): [number, number, number] {
  if (!isStableVersion(value)) throw new Error(`metadata invalid version: ${value}`)
  return value.split(".").map(Number) as [number, number, number]
}
