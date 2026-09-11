import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { UpdateCacheLifecycle } from "@main/update-cache-lifecycle"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe("UpdateCacheLifecycle", () => {
  it("版本匹配的健康启动删除更新缓存和安装意图", async () => {
    const paths = await createPaths()
    const service = createService(paths, "1.1.0")
    const cachePath = path.join(paths.updaterCache, "update.zip")
    await writeBytes(cachePath, 1024)
    await service.recordInstallIntent("1.1.0", 2)

    await expect(service.clearAfterHealthyStart()).resolves.toBe("cleared")
    await expect(readFile(cachePath)).rejects.toThrow()
    await expect(
      readFile(path.join(paths.userData, "update-install-intent.json")),
    ).rejects.toThrow()
  })

  it("版本不匹配时保留缓存和安装意图", async () => {
    const paths = await createPaths()
    const service = createService(paths, "1.0.0")
    const cachePath = path.join(paths.updaterCache, "update.zip")
    await writeBytes(cachePath, 1024)
    await service.recordInstallIntent("1.1.0", 2)

    await expect(service.clearAfterHealthyStart()).resolves.toBe("version_mismatch")
    await expect(readFile(cachePath)).resolves.toBeInstanceOf(Buffer)
    await expect(
      readFile(path.join(paths.userData, "update-install-intent.json")),
    ).resolves.toBeInstanceOf(Buffer)
  })

  it("无效安装意图不会触发缓存清理", async () => {
    const paths = await createPaths()
    const service = createService(paths, "1.1.0")
    const cachePath = path.join(paths.updaterCache, "update.zip")
    await writeBytes(cachePath, 1024)
    await mkdir(paths.userData, { recursive: true })
    await writeFile(path.join(paths.userData, "update-install-intent.json"), "{invalid")

    await expect(service.clearAfterHealthyStart()).resolves.toBe("invalid_intent")
    await expect(readFile(cachePath)).resolves.toBeInstanceOf(Buffer)
    await expect(
      readFile(path.join(paths.userData, "update-install-intent.json")),
    ).rejects.toThrow()
  })

  it("缓存清理失败后保留安装意图并在下次启动重试", async () => {
    const paths = await createPaths()
    const cachePath = path.join(paths.updaterCache, "update.zip")
    const removePath: RemovePath = async (target, options) => {
      if (target === paths.updaterCache) throw new Error("permission denied")
      await rm(target, options)
    }
    const firstStart = createService(paths, "1.1.0", removePath)
    await writeBytes(cachePath, 1024)
    await firstStart.recordInstallIntent("1.1.0", 2)

    await expect(firstStart.clearAfterHealthyStart()).resolves.toBe("retry_pending")
    await expect(readFile(cachePath)).resolves.toBeInstanceOf(Buffer)
    await expect(
      readFile(path.join(paths.userData, "update-install-intent.json")),
    ).resolves.toBeInstanceOf(Buffer)

    const secondStart = createService(paths, "1.1.0")
    await expect(secondStart.clearAfterHealthyStart()).resolves.toBe("cleared")
    await expect(readFile(cachePath)).rejects.toThrow()
    await expect(
      readFile(path.join(paths.userData, "update-install-intent.json")),
    ).rejects.toThrow()
  })

  it("以最小版本化内容原子记录安装意图", async () => {
    const paths = await createPaths()
    const service = createService(paths, "1.0.0")

    await service.recordInstallIntent("1.1.0", 2)

    await expect(
      readFile(path.join(paths.userData, "update-install-intent.json"), "utf8"),
    ).resolves.toBe('{"schemaVersion":2,"targetBuild":2,"targetVersion":"1.1.0"}\n')
  })

  it("版本相同但 build 不匹配时保留缓存和安装意图", async () => {
    const paths = await createPaths()
    const service = createService(paths, "1.1.0", undefined, 1)
    const cachePath = path.join(paths.updaterCache, "update.zip")
    await writeBytes(cachePath, 1024)
    await service.recordInstallIntent("1.1.0", 2)

    await expect(service.clearAfterHealthyStart()).resolves.toBe("build_mismatch")
    await expect(readFile(cachePath)).resolves.toBeInstanceOf(Buffer)
  })

  it("兼容 schema 1 的 version-only 安装意图", async () => {
    const paths = await createPaths()
    const service = createService(paths, "1.1.0")
    await writeBytes(path.join(paths.updaterCache, "update.zip"), 1024)
    await mkdir(paths.userData, { recursive: true })
    await writeFile(
      path.join(paths.userData, "update-install-intent.json"),
      '{"schemaVersion":1,"targetVersion":"1.1.0"}\n',
    )

    await expect(service.clearAfterHealthyStart()).resolves.toBe("cleared")
  })
})

async function createPaths(): Promise<{ updaterCache: string; userData: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "magicchat-update-cache-"))
  temporaryDirectories.push(root)
  return {
    updaterCache: path.join(root, "updater-cache"),
    userData: path.join(root, "user-data"),
  }
}

function createService(
  paths: { updaterCache: string; userData: string },
  currentVersion: string,
  removePath?: RemovePath,
  currentBuild = 2,
): UpdateCacheLifecycle {
  return new UpdateCacheLifecycle({
    currentBuild,
    currentVersion,
    removePath,
    updaterCachePath: paths.updaterCache,
    userDataPath: paths.userData,
  })
}

type RemovePath = (target: string, options: Parameters<typeof rm>[1]) => Promise<void>

async function writeBytes(filePath: string, size: number): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, Buffer.alloc(size))
}
