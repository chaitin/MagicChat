import { beforeEach, describe, expect, it, vi } from "vitest"
import type { UpdaterAdapter, UpdaterClock } from "@main/updater-service"

vi.mock("electron", () => ({
  app: { getVersion: () => "1.0.0", isPackaged: true },
  shell: { openExternal: vi.fn() },
}))

const { UpdaterService, classifyUpdateError } = await import("@main/updater-service")

describe("UpdaterService", () => {
  let adapter: FakeUpdater
  let clock: FakeClock

  beforeEach(() => {
    adapter = new FakeUpdater()
    clock = new FakeClock()
  })

  it("固定默认通道语义并复用进行中的检查", async () => {
    const pending = deferred<unknown>()
    adapter.checkResult = pending.promise
    const service = createService(adapter, clock)
    const first = service.check()
    const second = service.check()
    expect(first).toBe(second)
    expect(adapter.checkCalls).toBe(1)
    pending.resolve(undefined)
    await first
  })

  it("不暴露远端发布说明并保持下载进度单调", async () => {
    const service = createService(adapter, clock)
    const check = service.check()
    adapter.emit("update-available", {
      build: 2,
      releaseNotes: "<b>修复</b> https://evil.example/token\u0000",
      version: "1.1.0",
    })
    await check
    expect(service.current()).toMatchObject({ status: "available", targetVersion: "1.1.0" })
    expect(service.current()).not.toHaveProperty("releaseNotes")
    const download = service.download()
    expect(service.current().progress).toBeUndefined()
    adapter.emit("download-progress", { percent: 60 })
    adapter.emit("download-progress", { percent: 20 })
    expect(service.current().progress).toBe(60)
    adapter.emit("update-downloaded", { build: 2, version: "1.1.0" })
    await download
    expect(service.current()).toMatchObject({ progress: 100, status: "downloaded" })
  })

  it("拒绝乱序事件并在错误后使用不少于 15 分钟的退避", async () => {
    const service = createService(adapter, clock)
    adapter.emit("update-downloaded", { build: 2, version: "1.1.0" })
    expect(service.current().status).toBe("idle")
    adapter.checkResult = Promise.reject(new Error("status code 429"))
    await service.check()
    expect(service.current()).toMatchObject({ errorCode: "rate_limited", status: "error" })
    expect(clock.delays.at(-1)).toBe(15 * 60_000)
  })

  it("无更新后恢复 idle 并安排 6 小时轮询", async () => {
    const service = createService(adapter, clock)
    const check = service.check()
    adapter.emit("update-not-available")
    await check
    expect(service.current().status).toBe("idle")
    expect(clock.delays.at(-1)).toBe(6 * 60 * 60_000)
  })

  it("下载失败保持当前版本并进入可重试错误", async () => {
    const service = createService(adapter, clock)
    const check = service.check()
    adapter.emit("update-available", { build: 2, version: "1.1.0" })
    await check
    adapter.downloadResult = Promise.reject(new Error("checksum mismatch"))
    await service.download()
    expect(service.current()).toMatchObject({
      currentBuild: 1,
      currentVersion: "1.0.0",
      errorCode: "checksum_invalid",
      retryable: true,
      status: "error",
    })
  })

  it("丢弃已下载更新后恢复为可重新下载状态", async () => {
    const service = createService(adapter, clock)
    const check = service.check()
    adapter.emit("update-available", { build: 2, version: "1.1.0" })
    await check
    const download = service.download()
    adapter.emit("update-downloaded", { build: 2, version: "1.1.0" })
    await download

    expect(service.canDiscardDownloadedUpdate()).toBe(true)
    service.discardDownloadedUpdate()

    expect(service.current()).toMatchObject({
      retryable: true,
      status: "available",
      targetVersion: "1.1.0",
    })
  })

  it("下载或安装期间不允许丢弃更新缓存", async () => {
    const pending = deferred<unknown>()
    adapter.downloadResult = pending.promise
    const service = createService(adapter, clock)
    const check = service.check()
    adapter.emit("update-available", { build: 2, version: "1.1.0" })
    await check
    const download = service.download()

    expect(service.canDiscardDownloadedUpdate()).toBe(false)
    pending.resolve(undefined)
    await download
  })

  it("取消全量包下载后恢复为可重新下载状态", async () => {
    const pending = deferred<unknown>()
    adapter.downloadResult = pending.promise
    const service = createService(adapter, clock)
    const check = service.check()
    adapter.emit("update-available", { build: 2, version: "1.1.0" })
    await check
    const download = service.download()

    expect(service.cancelDownload()).toMatchObject({
      retryable: true,
      status: "available",
      targetVersion: "1.1.0",
    })
    pending.reject(new Error("network download canceled"))
    await download
    expect(adapter.cancelCalls).toBe(1)
    expect(service.current().status).toBe("available")
  })

  it("为已验证版本生成固定仓库的发布页地址", async () => {
    const opened: string[] = []
    const service = createService(adapter, clock, {
      context: {
        arch: "arm64",
        channel: "stable",
        currentBuild: 1,
        currentVersion: "1.0.0",
        packaged: true,
        platform: "darwin",
      },
      openExternal: async (url) => {
        opened.push(url)
      },
    })
    const check = service.check()
    adapter.emit("update-available", { build: 2, version: "1.1.0" })
    await check

    await service.openReleasePage()

    expect(opened).toEqual(["https://github.com/ptonlix/MagicChat/releases/tag/desktop-v1.1.0"])
  })

  it.each([
    ["darwin", "arm64", undefined, "Jiying-1.1.0-mac-universal.dmg"],
    ["win32", "x64", undefined, "Jiying-1.1.0-win-x64.exe"],
    ["win32", "arm64", undefined, "Jiying-1.1.0-win-arm64.exe"],
    ["linux", "x64", "/tmp/MagicChat.AppImage", "Jiying-1.1.0-linux-x86_64.AppImage"],
    ["linux", "arm64", "/tmp/MagicChat.AppImage", "Jiying-1.1.0-linux-arm64.AppImage"],
    ["linux", "x64", undefined, "Jiying-1.1.0-linux-amd64.deb"],
    ["linux", "arm64", undefined, "Jiying-1.1.0-linux-arm64.deb"],
  ] as const)(
    "为 %s %s 生成匹配安装来源的下载地址",
    async (platform, arch, appImagePath, fileName) => {
      const opened: string[] = []
      const service = createService(adapter, clock, {
        context: {
          appImagePath,
          arch,
          channel: "stable",
          currentBuild: 1,
          currentVersion: "1.0.0",
          packaged: true,
          platform,
        },
        openExternal: async (url) => {
          opened.push(url)
        },
      })
      const check = service.check()
      adapter.emit("update-available", { build: 2, version: "1.1.0" })
      await check

      await service.openManualDownload()

      expect(opened).toEqual([
        `https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.1.0/${fileName}`,
      ])
    },
  )

  it("安装前阻止活跃传输并保证安装器启动顺序", async () => {
    let active = true
    const order: string[] = []
    adapter.installUpdate = async () => {
      order.push("quit")
    }
    const service = createService(adapter, clock, {
      hasActiveTransfers: () => active,
      prepareInstall: async () => {
        order.push("prepare")
      },
      recordInstallIntent: async (targetVersion, targetBuild) => {
        order.push(`record:${targetVersion}:${targetBuild}`)
      },
    })
    const check = service.check()
    adapter.emit("update-available", { build: 2, version: "1.1.0" })
    await check
    const download = service.download()
    adapter.emit("update-downloaded", { build: 2, version: "1.1.0" })
    await download
    await expect(service.install()).resolves.toEqual({
      reason: "active_transfers",
      status: "blocked",
    })
    active = false
    await expect(service.install()).resolves.toEqual({ status: "started" })
    expect(order).toEqual(["prepare", "record:1.1.0:2", "quit"])
    expect(service.isInstallIntent()).toBe(true)
    await expect(service.install()).resolves.toEqual({
      reason: "not_downloaded",
      status: "blocked",
    })
  })

  it("安装准备失败后恢复为可重试错误状态", async () => {
    const service = createService(adapter, clock, {
      prepareInstall: () => Promise.reject(new Error("permission denied")),
    })
    const check = service.check()
    adapter.emit("update-available", { build: 2, version: "1.1.0" })
    await check
    const download = service.download()
    adapter.emit("update-downloaded", { build: 2, version: "1.1.0" })
    await download
    await expect(service.install()).resolves.toEqual({
      reason: "prepare_failed",
      status: "failed",
    })
    expect(service.current()).toMatchObject({
      errorCode: "permission_denied",
      retryable: true,
      status: "error",
    })
    expect(service.isInstallIntent()).toBe(false)
  })

  it("安装意图无法持久化时回滚退出准备且不调用安装器", async () => {
    const rollback = vi.fn()
    const recordInstallIntent = vi.fn(() => Promise.reject(new Error("permission denied")))
    const service = createService(adapter, clock, {
      prepareInstall: async () => rollback,
      recordInstallIntent,
    })
    const check = service.check()
    adapter.emit("update-available", { build: 2, version: "1.1.0" })
    await check
    const download = service.download()
    adapter.emit("update-downloaded", { build: 2, version: "1.1.0" })
    await download

    await expect(service.install()).resolves.toEqual({
      reason: "prepare_failed",
      status: "failed",
    })
    expect(recordInstallIntent).toHaveBeenCalledWith("1.1.0", 2)
    expect(rollback).toHaveBeenCalledOnce()
    expect(service.current()).toMatchObject({
      errorCode: "permission_denied",
      retryable: true,
      status: "error",
    })
  })

  it("安装器同步报告失败时回滚退出准备并返回失败", async () => {
    const rollback = vi.fn()
    const discardInstallIntent = vi.fn().mockResolvedValue(true)
    adapter.installUpdate = async () => {
      adapter.emit("error", new Error("permission denied"))
    }
    const service = createService(adapter, clock, {
      discardInstallIntent,
      prepareInstall: async () => rollback,
    })
    const check = service.check()
    adapter.emit("update-available", { build: 2, version: "1.1.0" })
    await check
    const download = service.download()
    adapter.emit("update-downloaded", { build: 2, version: "1.1.0" })
    await download

    await expect(service.install()).resolves.toEqual({
      reason: "install_failed",
      status: "failed",
    })
    expect(rollback).toHaveBeenCalledOnce()
    expect(service.current()).toMatchObject({
      errorCode: "permission_denied",
      retryable: true,
      status: "error",
    })
    expect(service.isInstallIntent()).toBe(false)
    await vi.waitFor(() => expect(discardInstallIntent).toHaveBeenCalledOnce())
  })

  it("安装器异步报告失败时回滚退出准备并保留当前应用", async () => {
    const rollback = vi.fn()
    const service = createService(adapter, clock, {
      prepareInstall: async () => rollback,
    })
    const check = service.check()
    adapter.emit("update-available", { build: 2, version: "1.1.0" })
    await check
    const download = service.download()
    adapter.emit("update-downloaded", { build: 2, version: "1.1.0" })
    await download

    await expect(service.install()).resolves.toEqual({ status: "started" })
    expect(service.isInstallIntent()).toBe(true)

    adapter.emit("error", new Error("Gatekeeper signature"))

    expect(rollback).toHaveBeenCalledOnce()
    expect(service.current()).toMatchObject({
      errorCode: "platform_signature_required",
      retryable: true,
      status: "error",
    })
    expect(service.isInstallIntent()).toBe(false)
  })

  it.each([
    ["win32", undefined],
    ["darwin", undefined],
    ["linux", "/tmp/MagicChat.AppImage"],
  ] as const)("在 %s 按准备、全量安装器顺序安装", async (platform, appImagePath) => {
    const order: string[] = []
    adapter.installUpdate = async () => {
      order.push("quit")
    }
    const service = createService(adapter, clock, {
      context: {
        appImagePath,
        arch: "x64",
        channel: "stable",
        currentBuild: 1,
        currentVersion: "1.0.0",
        packaged: true,
        platform,
      },
      prepareInstall: async () => {
        order.push("prepare")
      },
    })
    const check = service.check()
    adapter.emit("update-available", { build: 2, version: "1.1.0" })
    await check
    const download = service.download()
    adapter.emit("update-downloaded", { build: 2, version: "1.1.0" })
    await download
    await expect(service.install()).resolves.toEqual({ status: "started" })
    expect(order).toEqual(["prepare", "quit"])
    expect(adapter.offCalls).toBe(0)
  })

  it("dispose 清理定时器和 updater 监听器", () => {
    const service = createService(adapter, clock)
    service.dispose()
    expect(clock.cleared).toBe(1)
    expect(adapter.offCalls).toBe(6)
  })
})

describe("更新错误归一化", () => {
  it("分类稳定错误码", () => {
    expect(classifyUpdateError(new Error("ENOSPC: no space"))).toBe("disk_full")
    expect(classifyUpdateError(new Error("checksum mismatch"))).toBe("checksum_invalid")
    expect(classifyUpdateError(new Error("package empty"))).toBe("update_failed")
    expect(classifyUpdateError(new Error("Gatekeeper signature"))).toBe(
      "platform_signature_required",
    )
  })
})

function createService(
  adapter: FakeUpdater,
  clock: FakeClock,
  overrides: Partial<ConstructorParameters<typeof UpdaterService>[0]> = {},
) {
  return new UpdaterService({
    adapter,
    clock,
    context: {
      arch: "x64",
      channel: "stable",
      currentBuild: 1,
      currentVersion: "1.0.0",
      packaged: true,
      platform: "win32",
    },
    ...overrides,
  })
}

class FakeUpdater implements UpdaterAdapter {
  cancelCalls = 0
  checkCalls = 0
  checkResult: Promise<unknown> = Promise.resolve(undefined)
  downloadResult: Promise<unknown> = Promise.resolve(undefined)
  offCalls = 0
  private readonly listeners = new Map<string, Set<(payload?: unknown) => void>>()

  checkForUpdates(): Promise<unknown> {
    this.checkCalls += 1
    return this.checkResult
  }

  downloadUpdate(): Promise<unknown> {
    return this.downloadResult
  }

  cancelDownload(): void {
    this.cancelCalls += 1
  }

  discardDownloadedUpdate(): Promise<void> {
    return Promise.resolve()
  }

  installUpdate(): Promise<void> {
    return Promise.resolve()
  }

  on(event: string, listener: (payload?: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  off(event: string, listener: (payload?: unknown) => void): void {
    this.offCalls += 1
    this.listeners.get(event)?.delete(listener)
  }

  emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload)
  }
}

class FakeClock implements UpdaterClock {
  cleared = 0
  delays: number[] = []

  clearTimeout(timer: ReturnType<typeof setTimeout>): void {
    this.cleared += 1
    clearTimeout(timer)
  }

  random(): number {
    return 0
  }

  setTimeout(_callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    this.delays.push(delay)
    const timer = setTimeout(() => undefined, 60_000)
    timer.unref()
    return timer
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}
