import { net } from "electron"
import { AuthFailure, isRecord } from "../shared/auth"
import { APP_VERSION, BUILD_ID } from "../shared/build-info"
import type { ReleasePlatform, UpdateInfo } from "../shared/desktop"

const VERSION_URL = "https://jiying.chat/releases/version.json"
const UPDATE_TIMEOUT_MS = 5_000
const MAX_VERSION_RESPONSE_BYTES = 64 * 1024

export async function checkForUpdates(): Promise<UpdateInfo> {
  let response: Response
  try {
    response = await net.fetch(VERSION_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
    })
  } catch {
    throw new AuthFailure("update_check_failed", "无法检查更新，请稍后重试")
  }
  if (!response.ok) {
    throw new AuthFailure("update_check_failed", `检查更新失败（HTTP ${response.status}）`)
  }

  const value = await readLimitedJson(response)
  const platform = releasePlatform()
  const release = isRecord(value) ? value[platform] : undefined
  if (!isRecord(release)) {
    throw new AuthFailure("invalid_update_info", `更新信息缺少 ${platform} 发布通道`)
  }
  const latestBuildId = release.build
  const latestVersion = release.version
  const downloadUrl = release.url
  if (
    !Number.isSafeInteger(latestBuildId) ||
    (latestBuildId as number) < 0 ||
    typeof latestVersion !== "string" ||
    !latestVersion.trim() ||
    latestVersion.length > 64 ||
    typeof downloadUrl !== "string" ||
    !isTrustedReleaseUrl(downloadUrl)
  ) {
    throw new AuthFailure("invalid_update_info", "更新信息格式不正确")
  }

  return {
    platform,
    currentVersion: APP_VERSION,
    currentBuildId: BUILD_ID,
    latestVersion: latestVersion.trim(),
    latestBuildId: latestBuildId as number,
    downloadUrl,
    updateAvailable: (latestBuildId as number) > BUILD_ID,
  }
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
      url.pathname.startsWith("/releases/")
    )
  } catch {
    return false
  }
}

function releasePlatform(): ReleasePlatform {
  if (process.platform === "win32") return "windows"
  if (process.platform === "darwin") return "macos"
  if (process.platform === "linux") {
    if (process.arch === "arm64" || process.arch === "arm") return "linux-arm"
    if (process.arch === "x64" || process.arch === "ia32") return "linux-amd"
  }
  throw new AuthFailure(
    "unsupported_update_platform",
    `暂不支持检查 ${process.platform}/${process.arch} 平台更新`,
  )
}

async function readLimitedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new AuthFailure("invalid_update_info", "更新信息为空")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_VERSION_RESPONSE_BYTES) {
      await reader.cancel()
      throw new AuthFailure("invalid_update_info", "更新信息过大")
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new AuthFailure("invalid_update_info", "更新信息格式不正确")
  }
}
