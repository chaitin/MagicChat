import { randomUUID } from "node:crypto"
import { chmod, mkdir, open, rename, rm } from "node:fs/promises"
import path from "node:path"
import { RELEASE_ASSET_PREFIX } from "@main/app-identity"
import {
  desktopPackageFileName,
  desktopVersionKey,
  DESKTOP_VERSION_MANIFEST_URL,
  isAllowedDesktopManifestUrl,
  isAllowedDesktopPackageUrl,
  selectDesktopVersionEntry,
  type DesktopVersionEntry,
  type DesktopVersionKey,
} from "@main/desktop-version-manifest"

export type VersionJsonUpdaterEvent =
  | "checking-for-update"
  | "download-progress"
  | "error"
  | "update-available"
  | "update-downloaded"
  | "update-not-available"

export type VersionJsonUpdateInfo = DesktopVersionEntry

type FetchResponse = Pick<Response, "body" | "headers" | "json" | "ok" | "status" | "url">

type FetchTarget =
  | Readonly<{ kind: "manifest" }>
  | Readonly<{ entry: DesktopVersionEntry; key: DesktopVersionKey; kind: "package" }>

type VersionJsonUpdaterOptions = Readonly<{
  arch: string
  cacheDirectory: string
  currentBuild: number
  currentVersion: string
  fetcher: (url: string, init: RequestInit) => Promise<FetchResponse>
  installPackage: (filePath: string, entry: DesktopVersionEntry) => Promise<void>
  manifestUrl?: string
  platform: NodeJS.Platform
}>

export class VersionJsonUpdater {
  private available?: DesktopVersionEntry
  private downloadAbort?: AbortController
  private downloadedPath?: string
  private readonly listeners = new Map<VersionJsonUpdaterEvent, Set<(payload?: unknown) => void>>()

  constructor(private readonly options: VersionJsonUpdaterOptions) {
    if (!Number.isSafeInteger(options.currentBuild) || options.currentBuild < 0) {
      throw new Error("current build invalid")
    }
  }

  async checkForUpdates(): Promise<void> {
    this.emit("checking-for-update")
    const manifestUrl = this.options.manifestUrl ?? DESKTOP_VERSION_MANIFEST_URL
    if (!isAllowedDesktopManifestUrl(manifestUrl)) throw new Error("metadata invalid source")
    const response = await this.fetchWithTimeout(cacheBustedUrl(manifestUrl), 15_000, {
      kind: "manifest",
    })
    if (!response.ok) throw httpError(response.status, "metadata")
    const entry = selectDesktopVersionEntry(
      await response.json(),
      this.options.platform,
      this.options.arch,
    )
    if (!entry) throw new Error("platform architecture mismatch")
    if (entry.build <= this.options.currentBuild) {
      this.available = undefined
      this.emit("update-not-available", {
        build: this.options.currentBuild,
        version: this.options.currentVersion,
      })
      return
    }
    this.available = entry
    this.emit("update-available", entry)
  }

  async downloadUpdate(): Promise<void> {
    const entry = this.available
    if (!entry) throw new Error("metadata missing available update")
    await mkdir(this.options.cacheDirectory, { recursive: true })
    const extension = packageExtension(entry.url)
    const finalPath = path.join(
      this.options.cacheDirectory,
      `${RELEASE_ASSET_PREFIX}-${entry.version}.build-${entry.build}${extension}`,
    )
    const temporaryPath = `${finalPath}.${randomUUID()}.part`
    const abort = new AbortController()
    this.downloadAbort = abort
    try {
      const key = desktopVersionKey(this.options.platform, this.options.arch)
      if (!key) throw new Error("platform architecture mismatch")
      const response = await this.fetchWithTimeout(
        entry.url,
        30 * 60_000,
        { entry, key, kind: "package" },
        abort.signal,
      )
      if (!response.ok) throw httpError(response.status, "package")
      if (!response.body) throw new Error("network response body missing")
      const declaredLength = contentLength(response.headers.get("content-length"))
      const handle = await open(temporaryPath, "wx", 0o600)
      let received = 0
      try {
        const reader = response.body.getReader()
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          if (chunk.value.byteLength === 0) continue
          await handle.write(chunk.value)
          received += chunk.value.byteLength
          if (declaredLength !== undefined && declaredLength > 0) {
            this.emit("download-progress", {
              percent: Math.min(99, (received / declaredLength) * 100),
            })
          }
        }
      } finally {
        await handle.close()
      }
      if (received <= 0) throw new Error("package empty")
      await validatePackageHeader(temporaryPath, this.options.platform, this.options.arch)
      await rm(finalPath, { force: true })
      await rename(temporaryPath, finalPath)
      if (this.options.platform === "linux") await chmod(finalPath, 0o700)
      this.downloadedPath = finalPath
      this.emit("update-downloaded", entry)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    } finally {
      if (this.downloadAbort === abort) this.downloadAbort = undefined
    }
  }

  async installUpdate(): Promise<void> {
    if (!this.available || !this.downloadedPath) throw new Error("update package not downloaded")
    await this.options.installPackage(this.downloadedPath, this.available)
  }

  cancelDownload(): void {
    this.downloadAbort?.abort(new Error("network download canceled"))
  }

  async discardDownloadedUpdate(): Promise<void> {
    const downloadedPath = this.downloadedPath
    this.downloadedPath = undefined
    if (downloadedPath) await rm(downloadedPath, { force: true }).catch(() => undefined)
  }

  on(event: VersionJsonUpdaterEvent, listener: (payload?: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  off(event: VersionJsonUpdaterEvent, listener: (payload?: unknown) => void): void {
    this.listeners.get(event)?.delete(listener)
  }

  private emit(event: VersionJsonUpdaterEvent, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload)
  }

  private async fetchWithTimeout(
    url: string,
    timeoutMs: number,
    target: FetchTarget,
    parentSignal?: AbortSignal,
  ): Promise<FetchResponse> {
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(new Error("network request timed out")), timeoutMs)
    timer.unref?.()
    const signal = parentSignal ? AbortSignal.any([parentSignal, timeout.signal]) : timeout.signal
    try {
      let requestUrl = url
      for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
        assertTrustedFetchUrl(requestUrl, target)
        const response = await this.options.fetcher(requestUrl, {
          cache: "no-store",
          headers: {
            Accept: "application/json, application/octet-stream",
            "Cache-Control": "no-cache",
          },
          redirect: "manual",
          signal,
        })
        if (response.url && new URL(response.url).href !== new URL(requestUrl).href) {
          throw new Error("network unvalidated redirect")
        }
        if (!isRedirectStatus(response.status)) return response
        if (redirectCount === maximumRedirects) throw new Error("network redirect limit exceeded")
        const location = response.headers.get("location")
        if (!location) throw new Error("network redirect missing location")
        requestUrl = new URL(location, requestUrl).href
      }
      throw new Error("network redirect limit exceeded")
    } finally {
      clearTimeout(timer)
    }
  }
}

const maximumRedirects = 3
const githubRepositoryId = "1309442523"
const githubAssetQueryKeys = new Set([
  "X-Amz-Algorithm",
  "X-Amz-Credential",
  "X-Amz-Date",
  "X-Amz-Expires",
  "X-Amz-Signature",
  "X-Amz-SignedHeaders",
  "jwt",
  "response-content-disposition",
  "response-content-type",
  "rscd",
  "rsct",
  "se",
  "sig",
  "ske",
  "skoid",
  "sks",
  "skt",
  "sktid",
  "skv",
  "sp",
  "spr",
  "sr",
  "sv",
])

function assertTrustedFetchUrl(value: string, target: FetchTarget): void {
  if (target.kind === "manifest") {
    if (!isAllowedDesktopManifestUrl(value)) throw new Error("metadata invalid source")
    return
  }
  if (isAllowedDesktopPackageUrl(value, target.key, target.entry.version)) return
  if (
    new URL(target.entry.url).origin === "https://github.com" &&
    isAllowedGithubAssetCdnUrl(value, desktopPackageFileName(target.key, target.entry.version))
  ) {
    return
  }
  throw new Error("package invalid source")
}

function isAllowedGithubAssetCdnUrl(value: string, expectedFileName: string): boolean {
  if (value.length > 8_192) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash)
    return false
  const currentAssetPath = new RegExp(
    `^/github-production-release-asset/${githubRepositoryId}/[0-9a-f-]{16,}$`,
    "i",
  )
  const legacyAssetPath = new RegExp(
    `^/github-production-release-asset-2e65be/${githubRepositoryId}/[0-9a-f-]{16,}$`,
    "i",
  )
  if (
    !(
      (url.hostname === "release-assets.githubusercontent.com" &&
        currentAssetPath.test(url.pathname)) ||
      (url.hostname === "objects.githubusercontent.com" && legacyAssetPath.test(url.pathname))
    )
  ) {
    return false
  }
  for (const [key, queryValue] of url.searchParams.entries()) {
    if (
      !githubAssetQueryKeys.has(key) ||
      url.searchParams.getAll(key).length !== 1 ||
      queryValue.length === 0 ||
      queryValue.length > 4_096
    ) {
      return false
    }
  }
  const signature = url.searchParams.get("sig") ?? url.searchParams.get("X-Amz-Signature")
  const disposition =
    url.searchParams.get("rscd") ?? url.searchParams.get("response-content-disposition")
  if (!signature || !disposition) return false
  return [`filename=${expectedFileName}`, `filename="${expectedFileName}"`].some((marker) =>
    disposition.includes(marker),
  )
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

async function validatePackageHeader(
  filePath: string,
  platform: NodeJS.Platform,
  arch: string,
): Promise<void> {
  const handle = await open(filePath, "r")
  try {
    const fileStat = await handle.stat()
    if (platform === "darwin") {
      if (fileStat.size < 512) throw new Error("platform invalid macOS DMG")
      const trailer = Buffer.alloc(512)
      await handle.read(trailer, 0, trailer.length, fileStat.size - trailer.length)
      if (!trailer.includes(Buffer.from("koly"))) throw new Error("platform invalid macOS DMG")
      return
    }
    const header = Buffer.alloc(64)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (platform === "win32") {
      if (bytesRead < 2 || header[0] !== 0x4d || header[1] !== 0x5a) {
        throw new Error("platform invalid Windows installer")
      }
      return
    }
    if (
      bytesRead < 20 ||
      header[0] !== 0x7f ||
      header[1] !== 0x45 ||
      header[2] !== 0x4c ||
      header[3] !== 0x46
    ) {
      throw new Error("platform invalid Linux AppImage")
    }
    const littleEndian = header[5] === 1
    const machine = littleEndian ? header.readUInt16LE(18) : header.readUInt16BE(18)
    const expectedMachine = arch === "arm64" ? 183 : 62
    if (machine !== expectedMachine) throw new Error("platform architecture mismatch")
  } finally {
    await handle.close()
  }
}

function cacheBustedUrl(value: string): string {
  const url = new URL(value)
  url.searchParams.set("_", Date.now().toString())
  return url.toString()
}

function contentLength(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined
  const length = Number(value)
  return Number.isSafeInteger(length) && length >= 0 ? length : undefined
}

function httpError(status: number, kind: string): Error {
  return new Error(status === 429 ? `status code 429 ${kind}` : `network HTTP ${status} ${kind}`)
}

function packageExtension(value: string): string {
  const pathname = new URL(value).pathname.toLowerCase()
  if (pathname.endsWith(".exe")) return ".exe"
  if (pathname.endsWith(".dmg")) return ".dmg"
  if (pathname.endsWith(".appimage")) return ".AppImage"
  throw new Error("platform package extension mismatch")
}
