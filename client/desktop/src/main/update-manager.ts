import path from "node:path"
import { app, net, shell } from "electron"
import { AuthFailure } from "../shared/auth"
import type { UpdateInfo, UpdateProgress } from "../shared/desktop"
import { downloadUpdatePackage, validateUpdateFile } from "./update-download"
import { openDownloadedUpdate } from "./update-installer"
import { checkForUpdates } from "./update-service"

export class UpdateManager {
  private available: UpdateInfo | null = null
  private downloadedPath: string | null = null
  private downloadedSize: number | null = null
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
    if (!info.updateAvailable) {
      this.available = null
      this.downloadedPath = null
      this.downloadedSize = null
    } else {
      if (
        info.latestBuildId !== this.available?.latestBuildId ||
        info.downloadUrl !== this.available.downloadUrl
      ) {
        this.downloadedPath = null
        this.downloadedSize = null
      }
      this.available = info
    }
    return info
  }

  async download(): Promise<void> {
    if (this.pending) return this.pending
    const update = this.available
    if (!update) throw new AuthFailure("update_unavailable", "请先检查更新")
    const pending = downloadUpdatePackage({
      update,
      directory: this.cacheDirectory,
      fetcher: (url, options) => net.fetch(url, options),
      onProgress: this.onProgress,
    }).then(({ filePath, size }) => {
      if (this.available === update) {
        this.downloadedPath = filePath
        this.downloadedSize = size
      }
    })
    this.pending = pending
    try {
      await pending
    } catch (error) {
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
    try {
      await openDownloadedUpdate({
        platform: update.platform,
        filePath,
        openPath: (file) => shell.openPath(file),
        showItemInFolder: (file) => shell.showItemInFolder(file),
        quit: () => app.quit(),
      })
    } catch {
      throw new AuthFailure("update_install_failed", "无法打开更新安装包，请稍后重试")
    }
  }
}

export function updateCacheDirectory(userData: string): string {
  return path.join(userData, "updates")
}
