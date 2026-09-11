import { execFile } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import {
  assertDesktopBuildIncreases,
  fetchPublishedDesktopBuild,
  githubReleaseVersionUrl,
  readDesktopReleaseBuild,
  readPreviousDesktopReleaseBuild,
  resolveDesktopReleaseBuild,
} from "../release-build.mjs"

const execute = promisify(execFile)

describe("Desktop release build", () => {
  it("从 version base 读取四个平台一致的正整数 build", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "jiying-release-build-"))
    const filePath = path.join(directory, "release-version-base.json")
    await writeFile(filePath, desktopVersionBase(2))

    await expect(readDesktopReleaseBuild(filePath)).resolves.toBe(2)
  })

  it("拒绝缺失、非整数和非正数", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "jiying-release-build-invalid-"))
    for (const [name, contents] of [
      ["missing", "{}"],
      ["string", desktopVersionBase("2")],
      ["zero", desktopVersionBase(0)],
      ["fraction", desktopVersionBase(2.5)],
    ]) {
      const filePath = path.join(directory, `${name}.json`)
      await writeFile(filePath, contents)
      await expect(readDesktopReleaseBuild(filePath)).rejects.toThrow("正整数")
    }
  })

  it("拒绝四个 Desktop 平台 build 不一致", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "jiying-release-build-mismatch-"))
    const filePath = path.join(directory, "release-version-base.json")
    const value = JSON.parse(desktopVersionBase(2))
    value.macos.build = 3
    await writeFile(filePath, JSON.stringify(value))

    await expect(readDesktopReleaseBuild(filePath)).rejects.toThrow("必须一致")
  })

  it("没有上一正式 build 时允许当前正整数", () => {
    expect(() => assertDesktopBuildIncreases(1)).not.toThrow()
    expect(() => assertDesktopBuildIncreases(2, undefined)).not.toThrow()
  })

  it("当前 build 必须严格大于上一正式 build", () => {
    expect(() => assertDesktopBuildIncreases(3, 2, "desktop-v1.2.3")).not.toThrow()
    expect(() => assertDesktopBuildIncreases(2, 2, "desktop-v1.2.3")).toThrow(
      "必须严格大于上一正式版本 2（desktop-v1.2.3），当前为 2",
    )
    expect(() => assertDesktopBuildIncreases(2, 3, "desktop-v1.8.5")).toThrow(
      "必须严格大于上一正式版本 3（desktop-v1.8.5），当前为 2",
    )
  })

  it("没有历史正式 Tag 时不返回上一 build，并分配 1", async () => {
    const repository = await createRepository(2)
    await createAnnotatedTag(repository, "desktop-v1.2.3")

    await expect(
      readPreviousDesktopReleaseBuild({ currentTag: "desktop-v1.2.3", repository }),
    ).resolves.toBeUndefined()
    await expect(
      resolveDesktopReleaseBuild({ currentTag: "desktop-v1.2.3", repository }),
    ).resolves.toEqual({
      build: 1,
      previous: undefined,
    })
  })

  it("返回其他正式 Tag 中的最大 build，并忽略当前 Tag", async () => {
    const repository = await createRepository(2)
    await createAnnotatedTag(repository, "desktop-v1.2.3")
    await commitDesktopBuild(repository, 5)
    await createAnnotatedTag(repository, "desktop-v1.2.4")
    await commitDesktopBuild(repository, 4)
    await createAnnotatedTag(repository, "desktop-v1.3.0")

    await expect(
      readPreviousDesktopReleaseBuild({ currentTag: "desktop-v1.3.0", repository }),
    ).resolves.toEqual({ build: 5, tag: "desktop-v1.2.4" })
    await expect(
      readPreviousDesktopReleaseBuild({ currentTag: "desktop-v1.2.4", repository }),
    ).resolves.toEqual({ build: 4, tag: "desktop-v1.3.0" })
    await expect(
      resolveDesktopReleaseBuild({ currentTag: "desktop-v1.3.0", repository }),
    ).resolves.toEqual({
      build: 6,
      previous: { build: 5, tag: "desktop-v1.2.4" },
    })
  })

  it("同一 Tag 两次解析得到同一个自动分配的 build", async () => {
    const repository = await createRepository(2)
    await createAnnotatedTag(repository, "desktop-v1.2.3")
    await createAnnotatedTag(repository, "desktop-v1.2.4")

    const first = await resolveDesktopReleaseBuild({ currentTag: "desktop-v1.2.4", repository })
    const second = await resolveDesktopReleaseBuild({ currentTag: "desktop-v1.2.4", repository })
    expect(first).toEqual({ build: 3, previous: { build: 2, tag: "desktop-v1.2.3" } })
    expect(second).toEqual(first)
  })

  it("跳过 lightweight、错格式、缺失文件和无效清单的 Tag", async () => {
    const repository = await createRepository(2)
    await createAnnotatedTag(repository, "desktop-v1.2.3")
    await git(repository, ["tag", "desktop-v1.2.4"])
    await git(repository, ["tag", "-a", "desktop-v01.2.5", "-m", "invalid"])
    await git(repository, ["rm", "client-desktop/release-version-base.json"])
    await git(repository, ["commit", "-m", "remove version base"])
    await createAnnotatedTag(repository, "desktop-v1.2.6")
    await writeFile(
      path.join(repository, "client-desktop/release-version-base.json"),
      desktopVersionBaseMismatch(),
    )
    await git(repository, ["add", "."])
    await git(repository, ["commit", "-m", "invalid version base"])
    await createAnnotatedTag(repository, "desktop-v1.2.7")
    await commitDesktopBuild(repository, 3)
    await createAnnotatedTag(repository, "desktop-v1.2.8")

    await expect(
      readPreviousDesktopReleaseBuild({ currentTag: "desktop-v1.2.8", repository }),
    ).resolves.toEqual({ build: 2, tag: "desktop-v1.2.3" })
  })

  it("没有 version base 时从已公开 version.json 读取上一 build", async () => {
    const repository = await createRepository(2)
    await createAnnotatedTag(repository, "desktop-v1.2.3")
    await git(repository, ["rm", "client-desktop/release-version-base.json"])
    await git(repository, ["commit", "-m", "remove version base"])
    await createAnnotatedTag(repository, "desktop-v1.2.4")

    await expect(
      readPreviousDesktopReleaseBuild({
        currentTag: "desktop-v1.2.5",
        readPublishedDesktopBuild: async (tag) => (tag === "desktop-v1.2.4" ? 7 : undefined),
        repository,
      }),
    ).resolves.toEqual({ build: 7, tag: "desktop-v1.2.4" })
    await expect(
      resolveDesktopReleaseBuild({
        currentTag: "desktop-v1.2.5",
        readPublishedDesktopBuild: async (tag) => (tag === "desktop-v1.2.4" ? 7 : undefined),
        repository,
      }),
    ).resolves.toEqual({
      build: 8,
      previous: { build: 7, tag: "desktop-v1.2.4" },
    })
  })

  it("优先使用 Tag 提交中的 version base，而不是公开 version.json", async () => {
    const repository = await createRepository(4)
    await createAnnotatedTag(repository, "desktop-v1.2.3")

    await expect(
      readPreviousDesktopReleaseBuild({
        currentTag: "desktop-v1.2.4",
        readPublishedDesktopBuild: async () => 99,
        repository,
      }),
    ).resolves.toEqual({ build: 4, tag: "desktop-v1.2.3" })
  })

  it("公开 version.json 的 404 视为该 Tag 尚未发布", async () => {
    await expect(
      fetchPublishedDesktopBuild("desktop-v1.2.3", {
        fetchImpl: async () => ({ status: 404, ok: false }),
      }),
    ).resolves.toBeUndefined()
  })

  it("公开 version.json 网络或内容错误时失败", async () => {
    await expect(
      fetchPublishedDesktopBuild("desktop-v1.2.3", {
        fetchImpl: async () => {
          throw new Error("offline")
        },
      }),
    ).rejects.toThrow("无法读取 desktop-v1.2.3 的公开 version.json：offline")
    await expect(
      fetchPublishedDesktopBuild("desktop-v1.2.3", {
        fetchImpl: async () => ({ ok: false, status: 500 }),
      }),
    ).rejects.toThrow("HTTP 500")
    await expect(
      fetchPublishedDesktopBuild("desktop-v1.2.3", {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("nope")
          },
        }),
      }),
    ).rejects.toThrow("公开 version.json 无效")
  })

  it("从公开 version.json 读取四个平台一致的 build", async () => {
    expect(githubReleaseVersionUrl("desktop-v1.2.3")).toBe(
      "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.2.3/version.json",
    )
    await expect(
      fetchPublishedDesktopBuild("desktop-v1.2.3", {
        fetchImpl: async (url) => {
          expect(url).toBe(githubReleaseVersionUrl("desktop-v1.2.3"))
          return {
            ok: true,
            status: 200,
            json: async () => JSON.parse(desktopVersionBase(9)),
          }
        },
      }),
    ).resolves.toBe(9)
  })
})

async function createRepository(build) {
  const repository = await mkdtemp(path.join(os.tmpdir(), "jiying-release-build-git-"))
  await git(repository, ["init", "--initial-branch=main"])
  await git(repository, ["config", "user.name", "MagicChat Test"])
  await git(repository, ["config", "user.email", "test@magicchat.invalid"])
  await mkdir(path.join(repository, "client-desktop"), { recursive: true })
  await writeFile(path.join(repository, "client-desktop/package.json"), '{"version":"0.1.0"}\n')
  await writeFile(
    path.join(repository, "client-desktop/release-version-base.json"),
    desktopVersionBase(build),
  )
  await git(repository, ["add", "."])
  await git(repository, ["commit", "-m", "initial"])
  return repository
}

async function commitDesktopBuild(repository, build) {
  await writeFile(
    path.join(repository, "client-desktop/release-version-base.json"),
    desktopVersionBase(build),
  )
  await git(repository, ["add", "."])
  await git(repository, ["commit", "-m", `build ${build}`])
}

async function createAnnotatedTag(repository, tag) {
  await git(repository, ["tag", "-a", tag, "-m", `${tag} release notes`])
}

async function git(repository, arguments_) {
  const { stdout } = await execute("git", arguments_, { cwd: repository, encoding: "utf8" })
  return stdout.trim()
}

function desktopVersionBase(build) {
  return JSON.stringify({
    windows: { build },
    macos: { build },
    "linux-amd": { build },
    "linux-arm": { build },
  })
}

function desktopVersionBaseMismatch() {
  const value = JSON.parse(desktopVersionBase(2))
  value.macos.build = 9
  return JSON.stringify(value)
}
