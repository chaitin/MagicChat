import { AuthFailure, isRecord } from "../shared/auth.ts"
import type { ReleasePlatform, UpdateInfo } from "../shared/desktop"

export function releasePlatform(platform: NodeJS.Platform, arch: string): ReleasePlatform {
  if (platform === "win32" && arch === "x64") return "windows"
  if (platform === "darwin" && (arch === "x64" || arch === "arm64")) return "macos"
  if (platform === "linux" && arch === "x64") return "linux-amd"
  if (platform === "linux" && arch === "arm64") return "linux-arm"
  throw new AuthFailure("unsupported_update_platform", `暂不支持检查 ${platform}/${arch} 平台更新`)
}

export function updateFileExtension(platform: ReleasePlatform): string {
  if (platform === "windows") return ".exe"
  if (platform === "macos") return ".dmg"
  return ".AppImage"
}

export function isTrustedReleaseUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return (
      url.protocol === "https:" &&
      url.hostname === "jiying.chat" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname.startsWith("/releases/")
    )
  } catch {
    return false
  }
}

export function isTrustedUpdateFeed(input: string): boolean {
  if (!isTrustedReleaseUrl(input)) return false
  const pathname = new URL(input).pathname
  return (
    pathname.endsWith("/") &&
    !pathname.includes("%") &&
    pathname.split("/").every((segment) => segment !== "." && segment !== "..")
  )
}

function isNewerSemver(latest: string, installed: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(latest) || !/^\d+\.\d+\.\d+$/.test(installed)) return false
  const next = latest.split(".").map(Number)
  const current = installed.split(".").map(Number)
  if (!next.every(Number.isSafeInteger) || !current.every(Number.isSafeInteger)) return false
  for (let index = 0; index < 3; index++) {
    if (next[index] !== current[index]) return next[index] > current[index]
  }
  return false
}

export function parseUpdateInfo(
  value: unknown,
  platform: ReleasePlatform,
  currentVersion: string,
  currentBuildId: number,
): UpdateInfo {
  const release = isRecord(value) ? value[platform] : undefined
  if (!isRecord(release)) {
    throw new AuthFailure("invalid_update_info", `更新信息缺少 ${platform} 发布通道`)
  }
  const { build, version, url, updateFeed } = release
  if (
    !Number.isSafeInteger(build) ||
    (build as number) < 0 ||
    typeof version !== "string" ||
    !version.trim() ||
    version.length > 64 ||
    typeof url !== "string" ||
    !isTrustedReleaseUrl(url) ||
    !new URL(url).pathname.endsWith(updateFileExtension(platform)) ||
    (updateFeed !== undefined &&
      (typeof updateFeed !== "string" ||
        !isTrustedUpdateFeed(updateFeed) ||
        (platform !== "windows" && platform !== "macos"))) ||
    (updateFeed !== undefined &&
      (build as number) > currentBuildId &&
      !isNewerSemver(version as string, currentVersion))
  ) {
    throw new AuthFailure("invalid_update_info", "更新信息格式不正确")
  }
  return {
    platform,
    currentVersion,
    currentBuildId,
    latestVersion: version.trim(),
    latestBuildId: build as number,
    downloadUrl: url,
    ...(typeof updateFeed === "string" ? { updateFeed } : {}),
    updateAvailable: (build as number) > currentBuildId,
  }
}
