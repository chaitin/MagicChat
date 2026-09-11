import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { inspectReleaseTag, validateReleaseNotes } from "../release-tag.mjs"
import { prepareReleaseWorktree, releaseWorktreeRoot } from "../release-worktree.mjs"

const execute = promisify(execFile)
const validNotes = `即应 Desktop 1.2.3

## 版本亮点

- 发布流程更安全。

## 优化改进

- 收紧发布权限。`

describe("Desktop Annotated Tag", () => {
  it("接受 Annotated Tag 并绑定解引用 Commit", async () => {
    const repository = await createRepository()
    await createAnnotatedTag(repository, "desktop-v1.2.3")
    const head = await git(repository, ["rev-parse", "HEAD"])
    await expect(
      inspectReleaseTag({ expectedCommit: head, repository, tag: "desktop-v1.2.3" }),
    ).resolves.toMatchObject({
      commit: head,
      notes: validNotes,
      objectType: "tag",
      version: "1.2.3",
    })
  })

  it("拒绝 lightweight、错格式与错 Commit", async () => {
    const repository = await createRepository()
    await git(repository, ["tag", "desktop-v1.2.3"])
    await expect(inspectReleaseTag({ repository, tag: "desktop-v1.2.3" })).rejects.toThrow(
      "Annotated",
    )
    await expect(inspectReleaseTag({ repository, tag: "desktop-v01.2.3" })).rejects.toThrow()
    await createAnnotatedTag(repository, "desktop-v1.2.4")
    await writeFile(path.join(repository, "README.md"), "changed")
    await git(repository, ["add", "."])
    await git(repository, ["commit", "-m", "next"])
    await expect(
      inspectReleaseTag({ expectedCommit: "HEAD", repository, tag: "desktop-v1.2.4" }),
    ).rejects.toThrow("checkout 不一致")
  })

  it("接受 signed Tag 对象", async () => {
    const repository = await createRepository()
    const head = await git(repository, ["rev-parse", "HEAD"])
    const tagObject = `object ${head}
type commit
tag desktop-v1.2.5
tagger MagicChat Test <test@magicchat.invalid> 1700000000 +0000

${validNotes}
-----BEGIN PGP SIGNATURE-----
Version: fixture

signed-tag-fixture
-----END PGP SIGNATURE-----
`
    const objectFile = path.join(repository, "signed-tag-object")
    await writeFile(objectFile, tagObject)
    const objectId = await git(repository, ["hash-object", "-t", "tag", "-w", objectFile])
    await git(repository, ["update-ref", "refs/tags/desktop-v1.2.5", objectId])
    await expect(
      inspectReleaseTag({ expectedCommit: head, repository, tag: "desktop-v1.2.5" }),
    ).resolves.toMatchObject({
      commit: head,
      notes: validNotes,
      objectType: "tag",
      version: "1.2.5",
    })
  })

  it("允许发布者自由组织 Markdown", () => {
    expect(validateReleaseNotes("这次主要修复了登录和消息同步问题。")).toBe(
      "这次主要修复了登录和消息同步问题。",
    )
    expect(validateReleaseNotes("# 自定义标题\n\n### 不受模板限制\n\n- 修复问题")).toContain(
      "不受模板限制",
    )
  })

  it("拒绝空正文、控制字符与超长说明", () => {
    for (const notes of ["", `${validNotes}\u0000`, `${validNotes}\n${"x".repeat(33 * 1024)}`]) {
      expect(() => validateReleaseNotes(notes)).toThrow()
    }
  })

  it("旧 target 参数和缺失 Tag 在任何文件操作前失败", async () => {
    const marker = path.join(await mkdtemp(path.join(os.tmpdir(), "magicchat-caller-")), "marker")
    await writeFile(marker, "keep")
    const script = path.resolve(import.meta.dirname, "../prepare-release-worktree.mjs")
    for (const target of [
      process.cwd(),
      path.parse(process.cwd()).root,
      path.dirname(process.cwd()),
      marker,
    ]) {
      await expect(execute(process.execPath, [script, "--target", target])).rejects.toThrow()
      await expect(readFile(marker, "utf8")).resolves.toBe("keep")
    }
    await expect(execute(process.execPath, [script])).rejects.toThrow()
    await expect(readFile(marker, "utf8")).resolves.toBe("keep")
  })

  it("CI 优先在 Runner 临时目录创建工作树", () => {
    expect(releaseWorktreeRoot({ RUNNER_TEMP: "/runner/temp" })).toBe("/runner/temp")
    expect(releaseWorktreeRoot({})).toBe(os.tmpdir())
  })

  it("合法注入只修改内部临时构建树", async () => {
    const repository = await createRepository(true)
    await createAnnotatedTag(repository, "desktop-v1.2.3")
    await git(repository, ["push", "origin", "main", "desktop-v1.2.3"])
    const before = await repositorySnapshot(repository)
    const result = await prepareReleaseWorktree({
      expectedCommit: "HEAD",
      repository,
      tag: "desktop-v1.2.3",
    })
    const prepared = JSON.parse(
      await readFile(path.join(result.desktopDirectory, "package.json"), "utf8"),
    )
    expect(prepared.version).toBe("1.2.3")
    expect(prepared.desktopBuild).toBe(1)
    expect(result.build).toBe(1)
    expect(path.relative(releaseWorktreeRoot(), result.worktree)).not.toMatch(/^\.\.(?:[\\/]|$)/)
    expect(await repositorySnapshot(repository)).toEqual(before)
  })

  it("自动将 Desktop build 设为上一正式版本 + 1", async () => {
    const repository = await createRepository(true)
    await createAnnotatedTag(repository, "desktop-v1.2.3")
    await createAnnotatedTag(repository, "desktop-v1.2.4")
    const result = await prepareReleaseWorktree({
      expectedCommit: "HEAD",
      repository,
      tag: "desktop-v1.2.4",
    })
    expect(result.build).toBe(3)
  })

  it("同一 Tag 重跑复用自动分配的 Desktop build", async () => {
    const repository = await createRepository(true)
    await createAnnotatedTag(repository, "desktop-v1.2.3")
    const first = await prepareReleaseWorktree({
      expectedCommit: "HEAD",
      repository,
      tag: "desktop-v1.2.3",
    })
    const second = await prepareReleaseWorktree({
      expectedCommit: "HEAD",
      repository,
      tag: "desktop-v1.2.3",
    })
    expect(first.build).toBe(1)
    expect(second.build).toBe(1)
  })
})

async function createRepository(withDesktopPackage = false) {
  const repository = await mkdtemp(path.join(os.tmpdir(), "magicchat-tag-"))
  await git(repository, ["init", "--initial-branch=main"])
  await git(repository, ["config", "user.name", "MagicChat Test"])
  await git(repository, ["config", "user.email", "test@magicchat.invalid"])
  await writeFile(path.join(repository, "README.md"), "initial")
  if (withDesktopPackage) {
    await mkdir(path.join(repository, "client-desktop"))
    await writeFile(path.join(repository, "client-desktop/package.json"), '{"version":"0.1.0"}\n')
    await writeFile(
      path.join(repository, "client-desktop/release-version-base.json"),
      JSON.stringify({
        windows: { build: 2 },
        macos: { build: 2 },
        "linux-amd": { build: 2 },
        "linux-arm": { build: 2 },
      }),
    )
    const remote = await mkdtemp(path.join(os.tmpdir(), "magicchat-remote-"))
    await git(remote, ["init", "--bare"])
    await git(repository, ["remote", "add", "origin", remote])
  }
  await git(repository, ["add", "."])
  await git(repository, ["commit", "-m", "initial"])
  return repository
}

async function repositorySnapshot(repository) {
  const [source, status, head, tags, remote] = await Promise.all([
    readFile(path.join(repository, "client-desktop/package.json"), "utf8"),
    git(repository, ["status", "--short"]),
    git(repository, ["rev-parse", "HEAD"]),
    git(repository, ["show-ref", "--tags"]),
    git(repository, ["ls-remote", "origin"]),
  ])
  return { head, remote, source, status, tags }
}

async function createAnnotatedTag(repository, tag) {
  const notesFile = path.join(repository, "release-notes.md")
  await writeFile(notesFile, validNotes)
  await git(repository, ["tag", "-a", tag, "--cleanup=verbatim", "-F", notesFile])
}

async function git(repository, arguments_) {
  const { stdout } = await execute("git", arguments_, { cwd: repository, encoding: "utf8" })
  return stdout.trim()
}
