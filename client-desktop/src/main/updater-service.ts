import path from "node:path"
import { app, net, shell } from "electron"
import type {
  UpdaterErrorCode,
  UpdaterInstallResult,
  UpdaterState,
  UpdaterStatus,
} from "@shared/bridge"
import { releaseChannel } from "@main/diagnostics"
import { desktopBuild } from "@main/desktop-build"
import { RELEASE_ASSET_PREFIX, STABLE_UPDATER_CACHE_DIRECTORY_NAME } from "@main/app-identity"
import { determineUpdateEligibility, type UpdateEligibilityInput } from "@main/updater-eligibility"
import { installDesktopPackage } from "@main/desktop-package-installer"
import { isStableVersion } from "@main/desktop-version-manifest"
import { VersionJsonUpdater, type VersionJsonUpdaterEvent } from "@main/version-json-updater"

const INITIAL_CHECK_DELAY = 60_000
const NORMAL_CHECK_DELAY = 6 * 60 * 60_000
const MINIMUM_RETRY_DELAY = 15 * 60_000
const MAXIMUM_RETRY_DELAY = 6 * 60 * 60_000
const RELEASE_BASE_URL = "https://github.com/ptonlix/MagicChat/releases"

type UpdaterEvent = VersionJsonUpdaterEvent

export type UpdaterAdapter = {
  cancelDownload(): void
  checkForUpdates(): Promise<unknown>
  discardDownloadedUpdate(): Promise<void>
  downloadUpdate(): Promise<unknown>
  installUpdate(): Promise<void>
  off(event: UpdaterEvent, listener: (payload?: unknown) => void): unknown
  on(event: UpdaterEvent, listener: (payload?: unknown) => void): unknown
}

export type UpdaterClock = {
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
  random(): number
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
}

type UpdaterContext = UpdateEligibilityInput &
  Readonly<{
    currentBuild: number
    currentVersion: string
  }>

type InstallRollback = () => void

type UpdaterServiceOptions = Readonly<{
  adapter?: UpdaterAdapter
  clock?: UpdaterClock
  context?: UpdaterContext
  discardInstallIntent?: () => Promise<boolean>
  hasActiveTransfers?: () => boolean
  openExternal?: (url: string) => Promise<void>
  prepareInstall?: () => Promise<InstallRollback | void>
  recordInstallIntent?: (targetVersion: string, targetBuild: number) => Promise<void>
  updaterCachePath?: string
}>

const TRANSITIONS: Readonly<Record<UpdaterStatus, ReadonlySet<UpdaterStatus>>> = {
  available: new Set(["downloading", "error", "manual"]),
  checking: new Set(["available", "error", "idle", "manual"]),
  downloaded: new Set(["available", "error", "installing", "manual"]),
  downloading: new Set(["available", "downloaded", "error", "manual"]),
  error: new Set(["checking", "manual", "unsupported"]),
  idle: new Set(["checking", "manual", "unsupported"]),
  installing: new Set(["downloaded", "error", "manual"]),
  manual: new Set(["available", "checking", "error", "idle", "unsupported"]),
  unsupported: new Set(),
}

export class UpdaterService {
  private readonly adapter: UpdaterAdapter
  private readonly clock: UpdaterClock
  private readonly context: UpdaterContext
  private readonly discardInstallIntent: () => Promise<boolean>
  private readonly eligibility: ReturnType<typeof determineUpdateEligibility>
  private readonly hasActiveTransfers: () => boolean
  private readonly listeners = new Set<(state: UpdaterState) => void>()
  private readonly openExternal: (url: string) => Promise<void>
  private readonly prepareInstall: () => Promise<InstallRollback | void>
  private readonly recordInstallIntent: (
    targetVersion: string,
    targetBuild: number,
  ) => Promise<void>
  private readonly updaterListeners: ReadonlyArray<
    readonly [UpdaterEvent, (payload?: unknown) => void]
  >
  private checkPromise?: Promise<UpdaterState>
  private downloadCanceled = false
  private disposed = false
  private downloadPromise?: Promise<void>
  private installIntent = false
  private installRollback?: InstallRollback
  private retryCount = 0
  private state: UpdaterState
  private targetDownloadUrl?: string
  private timer?: ReturnType<typeof setTimeout>

  constructor(options: UpdaterServiceOptions = {}) {
    this.clock = options.clock ?? systemClock()
    this.context = options.context ?? systemContext()
    this.adapter =
      options.adapter ??
      versionJsonUpdaterAdapter(this.context, options.updaterCachePath ?? systemUpdaterCachePath())
    this.discardInstallIntent = options.discardInstallIntent ?? (async () => true)
    this.eligibility = determineUpdateEligibility(this.context)
    this.hasActiveTransfers = options.hasActiveTransfers ?? (() => false)
    this.openExternal = options.openExternal ?? ((url) => shell.openExternal(url))
    this.prepareInstall = options.prepareInstall ?? (async () => undefined)
    this.recordInstallIntent = options.recordInstallIntent ?? (async () => undefined)
    this.state = this.initialState()
    this.updaterListeners = this.createUpdaterListeners()
    for (const [event, listener] of this.updaterListeners) this.adapter.on(event, listener)
    if (this.eligibility.canCheck) this.schedule(INITIAL_CHECK_DELAY)
  }

  subscribe(listener: (state: UpdaterState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  check(): Promise<UpdaterState> {
    if (this.disposed || !this.eligibility.canCheck) return Promise.resolve(this.state)
    if (this.checkPromise) return this.checkPromise
    if (!this.canTransition("checking")) return Promise.resolve(this.state)
    this.clearTimer()
    this.transition({ ...this.baseState(), status: "checking" })
    this.checkPromise = this.adapter
      .checkForUpdates()
      .catch((error: unknown) => {
        this.handleError(error)
      })
      .then(() => this.state)
      .finally(() => {
        this.checkPromise = undefined
        this.scheduleAfterOperation()
      })
    return this.checkPromise
  }

  download(): Promise<void> {
    if (this.disposed || this.eligibility.mode !== "ota" || this.state.status !== "available") {
      return Promise.resolve()
    }
    if (this.downloadPromise) return this.downloadPromise
    this.transition({ ...this.state, progress: undefined, status: "downloading" })
    this.downloadPromise = this.adapter
      .downloadUpdate()
      .then(() => undefined)
      .catch((error: unknown) => {
        if (this.downloadCanceled) {
          this.downloadCanceled = false
          return
        }
        this.handleError(error)
      })
      .finally(() => {
        this.downloadCanceled = false
        this.downloadPromise = undefined
      })
    return this.downloadPromise
  }

  cancelDownload(): UpdaterState {
    if (this.disposed || this.state.status !== "downloading") return this.state
    this.downloadCanceled = true
    this.adapter.cancelDownload()
    this.transition({
      ...this.baseState(),
      retryable: true,
      status: "available",
      targetBuild: this.state.targetBuild,
      targetVersion: this.state.targetVersion,
    })
    return this.state
  }

  async install(): Promise<UpdaterInstallResult> {
    if (this.disposed || this.state.status !== "downloaded") {
      return { reason: "not_downloaded", status: "blocked" }
    }
    if (this.hasActiveTransfers()) {
      return { reason: "active_transfers", status: "blocked" }
    }
    if (this.installIntent) return { reason: "install_in_progress", status: "blocked" }
    const targetVersion = this.state.targetVersion
    const targetBuild = this.state.targetBuild
    if (
      !targetVersion ||
      !isStableVersion(targetVersion) ||
      !Number.isSafeInteger(targetBuild) ||
      Number(targetBuild) <= 0
    ) {
      this.handleError(new Error("metadata invalid"))
      return { reason: "install_failed", status: "failed" }
    }
    this.installIntent = true
    this.transition({ ...this.state, retryable: false, status: "installing" })
    try {
      const rollback = await this.prepareInstall()
      this.installRollback = typeof rollback === "function" ? rollback : undefined
      await this.recordInstallIntent(targetVersion, Number(targetBuild))
    } catch (error) {
      this.handleError(error)
      return { reason: "prepare_failed", status: "failed" }
    }
    try {
      await this.adapter.installUpdate()
      return this.installIntent
        ? { status: "started" }
        : { reason: "install_failed", status: "failed" }
    } catch (error) {
      this.handleError(error)
      return { reason: "install_failed", status: "failed" }
    }
  }

  async openManualDownload(): Promise<void> {
    await this.openExternal(this.manualDownloadUrl())
  }

  async openReleasePage(): Promise<void> {
    await this.openExternal(this.releasePageUrl())
  }

  current(): UpdaterState {
    return this.state
  }

  isInstallIntent(): boolean {
    return this.installIntent
  }

  canDiscardDownloadedUpdate(): boolean {
    return !this.downloadPromise && !this.installIntent && this.state.status !== "downloading"
  }

  discardDownloadedUpdate(): void {
    if (!this.canDiscardDownloadedUpdate() || this.state.status !== "downloaded") return
    void this.adapter.discardDownloadedUpdate()
    this.transition({
      ...this.baseState(),
      retryable: true,
      status: "available",
      targetBuild: this.state.targetBuild,
      targetVersion: this.state.targetVersion,
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearTimer()
    this.adapter.cancelDownload()
    for (const [event, listener] of this.updaterListeners) this.adapter.off(event, listener)
    this.installRollback = undefined
    this.listeners.clear()
  }

  private initialState(): UpdaterState {
    const status =
      this.eligibility.mode === "unsupported"
        ? "unsupported"
        : this.eligibility.canCheck
          ? "idle"
          : "manual"
    return { ...this.baseState(), status }
  }

  private baseState(): Omit<UpdaterState, "status"> {
    return {
      currentBuild: this.context.currentBuild,
      currentVersion: this.context.currentVersion,
      installMode: this.eligibility.mode,
      installationSource: this.eligibility.installationSource,
      manualAction: this.manualAction(),
      retryable: false,
    }
  }

  private manualAction(): UpdaterState["manualAction"] {
    if (this.eligibility.mode === "unsupported") return undefined
    const label =
      this.context.platform === "darwin"
        ? "下载 macOS 安装包"
        : this.context.platform === "linux"
          ? this.eligibility.installationSource === "deb"
            ? "下载 deb"
            : "下载 AppImage"
          : "下载安装包"
    return { label }
  }

  private releasePageUrl(): string {
    const version = this.state.targetVersion
    return version && isStableVersion(version)
      ? `${RELEASE_BASE_URL}/tag/desktop-v${version}`
      : `${RELEASE_BASE_URL}/latest`
  }

  private manualDownloadUrl(): string {
    if (this.targetDownloadUrl && this.eligibility.installationSource !== "deb") {
      return this.targetDownloadUrl
    }
    const version = this.state.targetVersion
    if (!version || !isStableVersion(version)) return `${RELEASE_BASE_URL}/latest`
    const fileName = this.manualInstallerFileName(version)
    return fileName
      ? `${RELEASE_BASE_URL}/download/desktop-v${version}/${fileName}`
      : this.releasePageUrl()
  }

  private manualInstallerFileName(version: string): string | undefined {
    if (this.context.platform === "darwin")
      return `${RELEASE_ASSET_PREFIX}-${version}-mac-universal.dmg`
    if (this.context.platform === "win32") {
      return `${RELEASE_ASSET_PREFIX}-${version}-win-${this.context.arch}.exe`
    }
    if (this.context.platform !== "linux") return undefined
    if (this.eligibility.installationSource === "deb") {
      const arch = this.context.arch === "x64" ? "amd64" : this.context.arch
      return `${RELEASE_ASSET_PREFIX}-${version}-linux-${arch}.deb`
    }
    const arch = this.context.arch === "x64" ? "x86_64" : this.context.arch
    return `${RELEASE_ASSET_PREFIX}-${version}-linux-${arch}.AppImage`
  }

  private createUpdaterListeners(): ReadonlyArray<
    readonly [UpdaterEvent, (payload?: unknown) => void]
  > {
    return [
      ["checking-for-update", () => this.transition({ ...this.baseState(), status: "checking" })],
      ["update-available", (payload) => this.handleAvailable(payload)],
      ["update-not-available", () => this.handleNotAvailable()],
      ["download-progress", (payload) => this.handleProgress(payload)],
      ["update-downloaded", (payload) => this.handleDownloaded(payload)],
      ["error", (payload) => this.handleError(payload)],
    ]
  }

  private handleAvailable(payload: unknown): void {
    const info = updateInfo(payload)
    if (!info || !isStableVersion(info.version)) {
      this.handleError(new Error("metadata invalid"))
      return
    }
    this.retryCount = 0
    this.targetDownloadUrl = info.url
    this.transition({
      ...this.baseState(),
      manualAction: this.manualAction(),
      retryable: this.eligibility.mode === "ota",
      status: "available",
      targetBuild: info.build,
      targetVersion: info.version,
    })
  }

  private handleNotAvailable(): void {
    this.retryCount = 0
    this.targetDownloadUrl = undefined
    this.transition({ ...this.baseState(), status: "idle" })
  }

  private handleProgress(payload: unknown): void {
    if (this.state.status !== "downloading") return
    const percent = progressPercent(payload)
    if (percent === undefined) return
    const previous = this.state.progress ?? 0
    this.transition({ ...this.state, progress: Math.max(previous, percent), status: "downloading" })
  }

  private handleDownloaded(payload: unknown): void {
    if (this.state.status !== "downloading") return
    const info = updateInfo(payload)
    this.transition({
      ...this.state,
      progress: 100,
      retryable: true,
      status: "downloaded",
      targetBuild: info?.build ?? this.state.targetBuild,
      targetVersion: info?.version ?? this.state.targetVersion,
    })
  }

  private handleError(error: unknown): void {
    if (this.disposed || this.state.status === "error" || !this.canTransition("error")) return
    if (this.state.status === "installing") this.rollbackInstall()
    const errorCode = classifyUpdateError(error)
    this.retryCount += 1
    this.transition({
      ...this.state,
      errorCode,
      retryable: true,
      status: "error",
    })
  }

  private rollbackInstall(): void {
    this.installIntent = false
    const rollback = this.installRollback
    this.installRollback = undefined
    rollback?.()
    void this.discardInstallIntent().catch(() => undefined)
  }

  private transition(next: UpdaterState): boolean {
    if (this.disposed || (next.status !== this.state.status && !this.canTransition(next.status))) {
      return false
    }
    this.state = next
    for (const listener of this.listeners) listener(next)
    return true
  }

  private canTransition(status: UpdaterStatus): boolean {
    return status === this.state.status || TRANSITIONS[this.state.status].has(status)
  }

  private scheduleAfterOperation(): void {
    if (this.disposed || !this.eligibility.canCheck) return
    if (this.state.status === "error") {
      const exponential = Math.min(
        MAXIMUM_RETRY_DELAY,
        MINIMUM_RETRY_DELAY * 2 ** Math.max(0, this.retryCount - 1),
      )
      this.schedule(Math.min(MAXIMUM_RETRY_DELAY, exponential * (1 + this.clock.random() * 0.2)))
      return
    }
    if (this.state.status === "idle") this.schedule(NORMAL_CHECK_DELAY)
  }

  private schedule(delay: number): void {
    this.clearTimer()
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined
      void this.check()
    }, delay)
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (!this.timer) return
    this.clock.clearTimeout(this.timer)
    this.timer = undefined
  }
}

export function classifyUpdateError(error: unknown): UpdaterErrorCode {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (/rate.?limit|status code 429/.test(message)) return "rate_limited"
  if (/signature|codesign|gatekeeper|squirrel.*code/.test(message))
    return "platform_signature_required"
  if (/sha|checksum|digest/.test(message)) return "checksum_invalid"
  if (/metadata|yaml|parse|version/.test(message)) return "metadata_invalid"
  if (/platform|architecture|arch mismatch/.test(message)) return "platform_mismatch"
  if (/enospc|disk.*full|no space/.test(message)) return "disk_full"
  if (/eacces|eperm|permission|read-only/.test(message)) return "permission_denied"
  if (/network|timeout|timed out|offline|econn|enotfound/.test(message)) return "network"
  return "update_failed"
}

function updateInfo(value: unknown): { build: number; url?: string; version: string } | undefined {
  if (!value || typeof value !== "object" || !("version" in value)) return undefined
  const version = value.version
  const build = "build" in value ? value.build : undefined
  if (typeof version !== "string" || !Number.isSafeInteger(build) || Number(build) <= 0) {
    return undefined
  }
  const url = "url" in value && typeof value.url === "string" ? value.url : undefined
  return { build: Number(build), ...(url ? { url } : {}), version }
}

function progressPercent(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || !("percent" in value)) return undefined
  const percent = value.percent
  return typeof percent === "number" && Number.isFinite(percent)
    ? Math.max(0, Math.min(100, percent))
    : undefined
}

function systemContext(): UpdaterContext {
  return {
    appImagePath: process.env.APPIMAGE,
    arch: process.arch,
    channel: releaseChannel(),
    currentBuild: desktopBuild(),
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
  }
}

function systemClock(): UpdaterClock {
  return {
    clearTimeout: (timer) => clearTimeout(timer),
    random: () => Math.random(),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
  }
}

function versionJsonUpdaterAdapter(
  context: UpdaterContext,
  cacheDirectory: string,
): UpdaterAdapter {
  return new VersionJsonUpdater({
    arch: context.arch,
    cacheDirectory,
    currentBuild: context.currentBuild,
    currentVersion: context.currentVersion,
    fetcher: (url, init) => net.fetch(url, init),
    installPackage: (downloadedPath) =>
      installDesktopPackage({
        appImagePath: context.appImagePath,
        downloadedPath,
        openPath: (filePath) => shell.openPath(filePath),
        platform: context.platform,
        quit: () => app.quit(),
      }),
    platform: context.platform,
  })
}

function systemUpdaterCachePath(): string {
  const home = app.getPath("home")
  const parent =
    process.platform === "darwin"
      ? path.join(home, "Library", "Caches")
      : process.platform === "win32"
        ? (process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"))
        : (process.env.XDG_CACHE_HOME ?? path.join(home, ".cache"))
  return path.join(parent, STABLE_UPDATER_CACHE_DIRECTORY_NAME)
}
