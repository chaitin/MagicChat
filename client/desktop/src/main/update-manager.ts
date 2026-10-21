import path from "node:path"
import { stat } from "node:fs/promises"
import { app, autoUpdater as macSystemUpdater, net, shell } from "electron"
import { AuthFailure } from "../shared/auth"
import type { UpdateInfo, UpdateProgress } from "../shared/desktop"
import { downloadUpdatePackage, validateUpdateFile } from "./update-download"
import { openDownloadedUpdate } from "./update-installer"
import { downloadNativeUpdate, installOnNextMacQuit, loadNativeUpdater } from "./update-native"
import { checkForUpdates } from "./update-service"

export class UpdateManager {
  private available: UpdateInfo | null = null
  private downloadedPath: string | null = null
  private downloadedSize: number | null = null
  private downloadedByUpdater = false
  private updaterErrorsHandled = false
  private cancelMacInstallOnQuit: (() => void) | null = null
  private pending: Promise<void> | null = null
  private checkedAt = 0

  constructor(
    private readonly cacheDirectory: string,
    private readonly onProgress: (progress: UpdateProgress) => void,
  ) {}

  async check(): Promise<UpdateInfo> {
    if (this.pending && this.available) return this.available
    if (this.available && Date.now() - this.checkedAt < 60_000) return this.available
    const info = await checkForUpdates()
    this.checkedAt = Date.now()
    const changed =
      info.latestBuildId !== this.available?.latestBuildId ||
      info.downloadUrl !== this.available?.downloadUrl ||
      info.updateFeed !== this.available?.updateFeed
    if (
      this.downloadedByUpdater &&
      this.available?.platform === "macos" &&
      (!info.updateAvailable || changed)
    ) {
      this.cancelMacInstallOnQuit?.()
      this.cancelMacInstallOnQuit = null
      const autoUpdater = await loadNativeUpdater()
      autoUpdater.autoInstallOnAppQuit = false
    }
    if (!info.updateAvailable) {
      this.available = null
      this.downloadedPath = null
      this.downloadedSize = null
      this.downloadedByUpdater = false
    } else {
      if (changed) {
        this.downloadedPath = null
        this.downloadedSize = null
        this.downloadedByUpdater = false
      }
      this.available = info
    }
    return info
  }

  async download(): Promise<void> {
    if (this.pending) return this.pending
    const update = this.available
    if (!update) throw new AuthFailure("update_unavailable", "请先检查更新")
    const useNativeUpdater =
      app.isPackaged &&
      Boolean(update.updateFeed) &&
      (update.platform === "windows" || update.platform === "macos")
    const pending = (
      useNativeUpdater
        ? loadNativeUpdater().then(async (autoUpdater) => {
            if (!this.updaterErrorsHandled) {
              autoUpdater.on("error", (error) => console.error("自动更新失败", error))
              this.updaterErrorsHandled = true
            }
            const filePath = await downloadNativeUpdate(
              update,
              autoUpdater,
              this.onProgress,
              update.platform === "macos" ? macSystemUpdater : undefined,
            )
            const { size } = await stat(filePath)
            return { filePath, size, nativeUpdater: autoUpdater }
          })
        : downloadUpdatePackage({
            update,
            directory: this.cacheDirectory,
            fetcher: (url, options) => net.fetch(url, options),
            onProgress: this.onProgress,
          }).then(({ filePath, size }) => ({ filePath, size, nativeUpdater: null }))
    ).then(async ({ filePath, size, nativeUpdater }) => {
      if (!(await validateUpdateFile(filePath, update.platform, size))) {
        throw new Error("更新安装包格式不正确")
      }
      if (this.available === update) {
        this.downloadedPath = filePath
        this.downloadedSize = size
        this.downloadedByUpdater = useNativeUpdater
        if (update.platform === "macos" && nativeUpdater) {
          this.cancelMacInstallOnQuit?.()
          this.cancelMacInstallOnQuit = installOnNextMacQuit(app, nativeUpdater)
        }
      }
    })
    this.pending = pending
    try {
      await pending
    } catch (error) {
      console.error("下载更新失败", error)
      if (useNativeUpdater && update.platform === "macos") {
        await loadNativeUpdater()
          .then((autoUpdater) => {
            autoUpdater.autoInstallOnAppQuit = false
          })
          .catch(() => undefined)
      }
      throw new AuthFailure(
        "update_download_failed",
        error instanceof Error && error.message.startsWith("更新安装包")
          ? error.message
          : "下载更新失败，请稍后重试",
      )
    } finally {
      if (this.pending === pending) this.pending = null
    }
  }

  async install(): Promise<void> {
    const update = this.available
    const filePath = this.downloadedPath
    if (!update || !filePath || this.downloadedSize === null || this.pending) {
      throw new AuthFailure("update_not_downloaded", "请先下载更新安装包")
    }
    if (!(await validateUpdateFile(filePath, update.platform, this.downloadedSize))) {
      this.downloadedPath = null
      this.downloadedSize = null
      throw new AuthFailure("update_file_invalid", "更新安装包已损坏，请重新下载")
    }
    if (update.platform === "macos" && this.downloadedByUpdater) return
    try {
      await openDownloadedUpdate({
        platform: update.platform,
        filePath,
        openPath: (file) => shell.openPath(file),
        showItemInFolder: (file) => shell.showItemInFolder(file),
      })
    } catch {
      throw new AuthFailure("update_install_failed", "无法打开更新安装包，请稍后重试")
    }
  }

  async restartToInstall(): Promise<void> {
    if (
      this.available?.platform !== "macos" ||
      !this.downloadedByUpdater ||
      !this.downloadedPath ||
      this.downloadedSize === null ||
      this.pending
    ) {
      throw new AuthFailure("update_not_downloaded", "请先下载更新安装包")
    }
    if (!(await validateUpdateFile(this.downloadedPath, "macos", this.downloadedSize))) {
      throw new AuthFailure("update_file_invalid", "更新安装包已损坏，请重新下载")
    }
    this.cancelMacInstallOnQuit?.()
    this.cancelMacInstallOnQuit = null
    const autoUpdater = await loadNativeUpdater()
    autoUpdater.autoRunAppAfterInstall = true
    autoUpdater.quitAndInstall(false, true)
  }
}

export function updateCacheDirectory(userData: string): string {
  return path.join(userData, "updates")
}
