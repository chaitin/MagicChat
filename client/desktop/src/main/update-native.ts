import path from "node:path"
import type { App } from "electron"
import type { AppUpdater } from "electron-updater"
import type { UpdateInfo, UpdateProgress } from "../shared/desktop"
import { isTrustedUpdateFeed } from "./update-policy.ts"

export type NativeUpdater = Pick<
  AppUpdater,
  | "autoDownload"
  | "autoInstallOnAppQuit"
  | "disableDifferentialDownload"
  | "disableWebInstaller"
  | "setFeedURL"
  | "checkForUpdates"
  | "downloadUpdate"
  | "on"
  | "off"
>

export function validateNativeMetadata(
  update: UpdateInfo,
  metadata: { version: string; files?: Array<{ url: string; size?: number; sha512?: string }> },
): void {
  const extension = update.platform === "windows" ? ".exe" : ".zip"
  if (
    !update.updateFeed ||
    !isTrustedUpdateFeed(update.updateFeed) ||
    metadata.version !== update.latestVersion ||
    !metadata.files?.length ||
    !metadata.files.some((file) => file.url.endsWith(extension)) ||
    metadata.files.some(
      (file) =>
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file.url) ||
        !Number.isSafeInteger(file.size) ||
        (file.size ?? 0) <= 0 ||
        (file.size ?? 0) > 2_000_000_000 ||
        !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512 ?? ""),
    )
  ) {
    throw new Error("更新元数据与发布清单不一致")
  }
}

export interface MacSystemUpdaterEvents {
  on(event: "update-downloaded", listener: () => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
  off(event: "update-downloaded", listener: () => void): unknown
  off(event: "error", listener: (error: Error) => void): unknown
}

export function installOnNextMacQuit(
  application: Pick<App, "on" | "off">,
  updater: Pick<AppUpdater, "autoRunAppAfterInstall" | "quitAndInstall">,
): () => void {
  const onQuit = () => {
    application.off("before-quit", onQuit)
    updater.autoRunAppAfterInstall = false
    updater.quitAndInstall()
  }
  application.on("before-quit", onQuit)
  return () => application.off("before-quit", onQuit)
}

export async function downloadNativeUpdate(
  update: UpdateInfo,
  updater: NativeUpdater,
  onProgress: (progress: UpdateProgress) => void,
  macSystemUpdater?: MacSystemUpdaterEvents,
): Promise<string> {
  if (!update.updateFeed || !isTrustedUpdateFeed(update.updateFeed)) {
    throw new Error("更新发布源无效")
  }
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = update.platform === "macos"
  updater.disableDifferentialDownload = false
  updater.disableWebInstaller = true
  updater.setFeedURL(update.updateFeed)
  const onDownloadProgress = (progress: {
    transferred: number
    total: number
    percent: number
  }) => {
    onProgress({
      received: progress.transferred,
      total: progress.total > 0 ? progress.total : null,
      percent: progress.total > 0 ? Math.floor(progress.percent) : null,
    })
  }
  if (update.platform === "macos" && !macSystemUpdater) {
    throw new Error("缺少 macOS 系统更新器")
  }
  updater.on("download-progress", onDownloadProgress)
  let stagingTimer: ReturnType<typeof setTimeout> | undefined
  let onStaged: () => void = () => undefined
  let onStageError: (error: Error) => void = () => undefined
  let staging: Promise<void> | undefined
  if (macSystemUpdater && update.platform === "macos") {
    staging = new Promise<void>((resolve, reject) => {
      onStaged = resolve
      onStageError = reject
    })
    void staging.catch(() => undefined)
    macSystemUpdater.on("update-downloaded", onStaged)
    macSystemUpdater.on("error", onStageError)
  }
  try {
    const result = await updater.checkForUpdates()
    if (!result?.isUpdateAvailable) throw new Error("更新源没有对应的新版安装包")
    validateNativeMetadata(update, result.updateInfo)
    const paths = await updater.downloadUpdate()
    if (staging) {
      await Promise.race([
        staging,
        new Promise<void>((_, reject) => {
          stagingTimer = setTimeout(() => reject(new Error("macOS 更新包尚未准备好")), 60_000)
        }),
      ])
    }
    const extension = update.platform === "windows" ? ".exe" : ".zip"
    const downloaded = paths.find((file) => path.extname(file).toLowerCase() === extension)
    if (!downloaded) throw new Error("更新包下载后缺少对应的平台文件")
    return downloaded
  } finally {
    if (stagingTimer) clearTimeout(stagingTimer)
    if (staging && macSystemUpdater) {
      macSystemUpdater.off("update-downloaded", onStaged)
      macSystemUpdater.off("error", onStageError)
    }
    updater.off("download-progress", onDownloadProgress)
  }
}
