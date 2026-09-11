import * as Application from "expo-application"
import * as FileSystem from "expo-file-system/legacy"
import * as IntentLauncher from "expo-intent-launcher"
import { Platform } from "react-native"

import { appConfig } from "@/config/app-config"
import {
  readPlatformRelease,
  type AppRelease,
  type MobileUpdatePlatform,
} from "@/features/updates/app-update-model"

const APK_MIME_TYPE = "application/vnd.android.package-archive"
const FLAG_GRANT_READ_URI_PERMISSION = 1
const RELEASE_REQUEST_TIMEOUT_MS = 15_000

export type InstalledAppVersion = {
  build: number | null
  label: string
  version: string
}

export type AndroidUpdateDownload = {
  cancel: () => Promise<void>
  start: () => Promise<string>
}

export function getMobileUpdatePlatform(): MobileUpdatePlatform {
  return Platform.OS === "ios" ? "ios" : "android"
}

export function getInstalledAppVersion(): InstalledAppVersion {
  const version = Application.nativeApplicationVersion?.trim() || "未知"
  const build = parseBuildNumber(Application.nativeBuildVersion)

  return {
    build,
    label: build === null ? version : `${version} (${build})`,
    version,
  }
}

export async function fetchLatestAppRelease(
  platform: MobileUpdatePlatform
): Promise<AppRelease> {
  const separator = appConfig.releaseManifestUrl.includes("?") ? "&" : "?"
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    RELEASE_REQUEST_TIMEOUT_MS
  )

  let response: Response
  try {
    response = await fetch(
      `${appConfig.releaseManifestUrl}${separator}timestamp=${Date.now()}`,
      {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }
    )
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("版本服务请求超时，请稍后重试")
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(`版本服务返回 ${response.status}`)
  }

  return readPlatformRelease(await response.json(), platform)
}

export function createAndroidUpdateDownload(
  release: AppRelease,
  onProgress: (progress: number) => void
): AndroidUpdateDownload {
  if (!FileSystem.cacheDirectory) {
    throw new Error("无法访问应用缓存目录")
  }

  let cancelled = false
  const fileUri = `${FileSystem.cacheDirectory}jiying-update-${release.build}.apk`
  const task = FileSystem.createDownloadResumable(
    release.url,
    fileUri,
    {},
    ({ totalBytesExpectedToWrite, totalBytesWritten }) => {
      if (totalBytesExpectedToWrite <= 0) return
      onProgress(
        Math.max(
          0,
          Math.min(1, totalBytesWritten / totalBytesExpectedToWrite)
        )
      )
    }
  )

  return {
    async cancel() {
      cancelled = true
      await task.cancelAsync().catch(() => undefined)
      await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(
        () => undefined
      )
    },
    async start() {
      await FileSystem.deleteAsync(fileUri, { idempotent: true })
      if (cancelled) throw new Error("安装包下载已取消")

      const result = await task.downloadAsync()

      if (!result || cancelled) {
        await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(
          () => undefined
        )
        throw new Error("安装包下载已取消")
      }
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`安装包下载失败（${result.status}）`)
      }

      onProgress(1)
      return result.uri
    },
  }
}

export async function installAndroidUpdate(fileUri: string) {
  if (Platform.OS !== "android") return

  const contentUri = await FileSystem.getContentUriAsync(fileUri)
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
    type: APK_MIME_TYPE,
  })
}

function parseBuildNumber(value: number | string | null | undefined) {
  const build =
    typeof value === "number" ? value : Number.parseInt(value ?? "", 10)
  return Number.isSafeInteger(build) && build >= 0 ? build : null
}
