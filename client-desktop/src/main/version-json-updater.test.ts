// @vitest-environment node

import { createHash } from "node:crypto"
import { access, mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { VersionJsonUpdater } from "@main/version-json-updater"

describe("VersionJsonUpdater", () => {
  it("从 version.json 发现新版本并直接下载全量安装包", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-version-updater-"))
    const installer = Buffer.alloc(1024, 0x5a)
    installer[0] = 0x4d
    installer[1] = 0x5a
    const packageUrl =
      "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.2.0/Jiying-1.2.0-win-x64.exe"
    const cdnUrl =
      "https://release-assets.githubusercontent.com/github-production-release-asset/1309442523/12345678-1234-1234-1234-123456789abc?sp=r&sig=trusted&rscd=attachment%3B%20filename%3DJiying-1.2.0-win-x64.exe"
    const manifest = {
      windows: {
        build: 12,
        sha512: createHash("sha512").update(installer).digest("base64"),
        size: installer.byteLength,
        url: packageUrl,
        version: "1.2.0",
      },
    }
    const requested: string[] = []
    const installPackage = vi.fn<(filePath: string) => Promise<void>>().mockResolvedValue(undefined)
    const updater = new VersionJsonUpdater({
      arch: "x64",
      cacheDirectory: directory,
      currentBuild: 1,
      currentVersion: "1.1.0",
      fetcher: async (url, init) => {
        requested.push(url)
        expect(init.redirect).toBe("manual")
        if (url.startsWith("https://jiying.chat/releases/version.json?")) {
          return new Response(JSON.stringify(manifest), {
            headers: { "content-type": "application/json" },
            status: 200,
          })
        }
        if (url === packageUrl) {
          return new Response(null, { headers: { location: cdnUrl }, status: 302 })
        }
        return new Response(installer, {
          headers: { "content-length": String(installer.byteLength) },
          status: 200,
        })
      },
      installPackage,
      platform: "win32",
    })
    const events: string[] = []
    updater.on("update-available", () => events.push("available"))
    updater.on("update-downloaded", () => events.push("downloaded"))

    await updater.checkForUpdates()
    await updater.downloadUpdate()
    await updater.installUpdate()

    expect(events).toEqual(["available", "downloaded"])
    expect(requested).toHaveLength(3)
    expect(requested[1]).toBe(packageUrl)
    expect(requested[2]).toBe(cdnUrl)
    expect(requested.every((url) => !url.endsWith(".blockmap"))).toBe(true)
    const downloadedPath = installPackage.mock.calls[0][0]
    expect(path.basename(downloadedPath)).toBe("Jiying-1.2.0.build-12.exe")
    await expect(access(downloadedPath)).resolves.toBeUndefined()
    await updater.discardDownloadedUpdate()
    await expect(access(downloadedPath)).rejects.toThrow()
  })

  it("官网三字段清单和无 Content-Length 响应可以完成下载", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-version-minimal-"))
    const installer = Buffer.alloc(1024, 0x5a)
    installer[0] = 0x4d
    installer[1] = 0x5a
    const manifest = {
      windows: {
        build: 12,
        url: "https://jiying.chat/releases/jiying.exe",
        version: "1.2.0",
      },
    }
    const installPackage = vi.fn<(filePath: string) => Promise<void>>().mockResolvedValue(undefined)
    const updater = new VersionJsonUpdater({
      arch: "x64",
      cacheDirectory: directory,
      currentBuild: 1,
      currentVersion: "1.1.0",
      fetcher: async (url) =>
        url.startsWith("https://jiying.chat/releases/version.json?")
          ? new Response(JSON.stringify(manifest), { status: 200 })
          : new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(installer)
                  controller.close()
                },
              }),
              { status: 200 },
            ),
      installPackage,
      platform: "win32",
    })

    await updater.checkForUpdates()
    await updater.downloadUpdate()
    await updater.installUpdate()

    expect(installPackage).toHaveBeenCalledOnce()
  })

  it("空安装包使用实际错误语义而不是 checksum 错误", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-version-empty-"))
    const manifest = {
      windows: {
        build: 12,
        url: "https://jiying.chat/releases/jiying.exe",
        version: "1.2.0",
      },
    }
    const updater = new VersionJsonUpdater({
      arch: "x64",
      cacheDirectory: directory,
      currentBuild: 1,
      currentVersion: "1.1.0",
      fetcher: async (url) =>
        url.startsWith("https://jiying.chat/releases/version.json?")
          ? new Response(JSON.stringify(manifest), { status: 200 })
          : new Response(new Uint8Array(), { status: 200 }),
      installPackage: async () => undefined,
      platform: "win32",
    })

    await updater.checkForUpdates()
    await expect(updater.downloadUpdate()).rejects.toThrow("package empty")
  })

  it("build 未增加时不下载，Windows ARM64 不会误用 x64 字段", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-version-current-"))
    const response = () =>
      new Response(
        JSON.stringify({
          windows: {
            build: 1,
            sha512: Buffer.alloc(64, 0x5a).toString("base64"),
            size: 1024,
            version: "1.1.0",
            url: "https://jiying.chat/releases/jiying.exe",
          },
        }),
        { status: 200 },
      )
    const current = new VersionJsonUpdater({
      arch: "x64",
      cacheDirectory: directory,
      currentBuild: 1,
      currentVersion: "1.1.0",
      fetcher: async () => response(),
      installPackage: async () => undefined,
      platform: "win32",
    })
    const unavailable = vi.fn()
    current.on("update-not-available", unavailable)
    await current.checkForUpdates()
    expect(unavailable).toHaveBeenCalledOnce()
    await expect(current.downloadUpdate()).rejects.toThrow("available")

    const arm = new VersionJsonUpdater({
      arch: "arm64",
      cacheDirectory: directory,
      currentBuild: 1,
      currentVersion: "1.0.0",
      fetcher: async () => response(),
      installPackage: async () => undefined,
      platform: "win32",
    })
    await expect(arm.checkForUpdates()).rejects.toThrow("architecture")
  })

  it("只按 build 判断更新，不使用 version 排序", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-version-build-only-"))
    const response = (build: number, version: string) =>
      new Response(
        JSON.stringify({
          windows: {
            build,
            url: "https://jiying.chat/releases/jiying.exe",
            version,
          },
        }),
        { status: 200 },
      )
    const lowerVersion = new VersionJsonUpdater({
      arch: "x64",
      cacheDirectory: directory,
      currentBuild: 2,
      currentVersion: "2.0.0",
      fetcher: async () => response(3, "1.0.0"),
      installPackage: async () => undefined,
      platform: "win32",
    })
    const available = vi.fn()
    lowerVersion.on("update-available", available)
    await lowerVersion.checkForUpdates()
    expect(available).toHaveBeenCalledWith(expect.objectContaining({ build: 3, version: "1.0.0" }))

    const higherVersion = new VersionJsonUpdater({
      arch: "x64",
      cacheDirectory: directory,
      currentBuild: 3,
      currentVersion: "1.0.0",
      fetcher: async () => response(3, "2.0.0"),
      installPackage: async () => undefined,
      platform: "win32",
    })
    const unavailable = vi.fn()
    higherVersion.on("update-not-available", unavailable)
    await higherVersion.checkForUpdates()
    expect(unavailable).toHaveBeenCalledOnce()
  })

  it("拒绝任意来源和未校验的跨站重定向", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-version-redirect-"))
    const installer = Buffer.alloc(1024, 0x5a)
    installer[0] = 0x4d
    installer[1] = 0x5a
    const manifest = {
      windows: {
        build: 12,
        sha512: createHash("sha512").update(installer).digest("base64"),
        size: installer.byteLength,
        url: "https://jiying.chat/releases/jiying.exe",
        version: "1.2.0",
      },
    }
    const requested: string[] = []
    const updater = new VersionJsonUpdater({
      arch: "x64",
      cacheDirectory: directory,
      currentBuild: 1,
      currentVersion: "1.1.0",
      fetcher: async (url) => {
        requested.push(url)
        return url.startsWith("https://jiying.chat/releases/version.json?")
          ? new Response(JSON.stringify(manifest), { status: 200 })
          : new Response(null, {
              headers: { location: "https://evil.example/Jiying-1.2.0-win-x64.exe" },
              status: 302,
            })
      },
      installPackage: async () => undefined,
      platform: "win32",
    })

    await updater.checkForUpdates()
    await expect(updater.downloadUpdate()).rejects.toThrow("package invalid source")
    expect(requested).toHaveLength(2)

    const invalidManifestUpdater = new VersionJsonUpdater({
      arch: "x64",
      cacheDirectory: directory,
      currentBuild: 1,
      currentVersion: "1.1.0",
      fetcher: async () => new Response(JSON.stringify(manifest), { status: 200 }),
      installPackage: async () => undefined,
      manifestUrl: "https://evil.example/releases/version.json",
      platform: "win32",
    })
    await expect(invalidManifestUpdater.checkForUpdates()).rejects.toThrow(
      "metadata invalid source",
    )

    const githubPackageUrl =
      "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.2.0/Jiying-1.2.0-win-x64.exe"
    const githubManifest = {
      windows: { ...manifest.windows, url: githubPackageUrl },
    }
    const wrongRepositoryCdnUpdater = new VersionJsonUpdater({
      arch: "x64",
      cacheDirectory: directory,
      currentBuild: 1,
      currentVersion: "1.1.0",
      fetcher: async (url) => {
        if (url.startsWith("https://jiying.chat/releases/version.json?")) {
          return new Response(JSON.stringify(githubManifest), { status: 200 })
        }
        return new Response(null, {
          headers: {
            location:
              "https://release-assets.githubusercontent.com/github-production-release-asset/999999999/12345678-1234-1234-1234-123456789abc?sp=r&sig=trusted&rscd=attachment%3B%20filename%3DJiying-1.2.0-win-x64.exe",
          },
          status: 302,
        })
      },
      installPackage: async () => undefined,
      platform: "win32",
    })
    await wrongRepositoryCdnUpdater.checkForUpdates()
    await expect(wrongRepositoryCdnUpdater.downloadUpdate()).rejects.toThrow(
      "package invalid source",
    )
  })
})
