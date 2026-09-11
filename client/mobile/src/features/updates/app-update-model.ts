export type MobileUpdatePlatform = "android" | "ios"

export type AppRelease = {
  build: number
  url: string
  version: string
}

export function readPlatformRelease(
  manifest: unknown,
  platform: MobileUpdatePlatform
): AppRelease {
  if (!isRecord(manifest)) {
    throw new Error("版本文件格式不正确")
  }

  const release = manifest[platform]
  if (!isRecord(release)) {
    throw new Error(`版本文件缺少 ${platform} 配置`)
  }

  const build = release.build
  const version = typeof release.version === "string" ? release.version.trim() : ""
  const url = typeof release.url === "string" ? release.url.trim() : ""

  if (!Number.isSafeInteger(build) || Number(build) < 0) {
    throw new Error("版本文件中的 build 不正确")
  }
  if (!version) {
    throw new Error("版本文件中的 version 不正确")
  }
  if (!url.startsWith("https://")) {
    throw new Error("版本文件中的下载地址必须使用 HTTPS")
  }

  return { build: Number(build), url, version }
}

export function hasNewAppVersion(
  installedBuild: number,
  release: AppRelease
) {
  return release.build > installedBuild
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
