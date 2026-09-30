import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { expectedReleaseAssetNames, prepareReleasePlan } from "../release-plan.mjs"
import { inspectReleaseTag } from "../release-tag.mjs"

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "desktop-release-test-"))
  git(root, "init", "-q")
  git(root, "config", "user.email", "test@example.invalid")
  git(root, "config", "user.name", "Test")
  await mkdir(path.join(root, "client/desktop"), { recursive: true })
  await writeFile(
    path.join(root, "client/desktop/package.json"),
    '{"version":"2.0.0","buildId":20}',
  )
  git(root, "add", ".")
  git(root, "commit", "-qm", "release fixture")
  git(root, "tag", "desktop/nightly-1")
  const inputDirectory = path.join(root, "artifacts")
  await mkdir(inputDirectory)
  for (const name of expectedReleaseAssetNames("2.0.0")) {
    const bytes = Buffer.alloc(1024)
    if (name.endsWith(".exe")) bytes.write("MZ")
    else if (name.endsWith(".AppImage")) {
      Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(bytes)
      bytes[5] = 1
      bytes.writeUInt16LE(name.includes("-arm64.") ? 0xb7 : 0x3e, 18)
    } else bytes.write("koly", 512)
    await writeFile(path.join(inputDirectory, name), bytes)
  }
  return {
    root,
    inputDirectory,
    outputDirectory: path.join(root, "prepared"),
    commit: git(root, "rev-parse", "HEAD"),
  }
}

test("任意标识的 desktop 标签保留 package 版本并生成四个平台发布计划", async () => {
  const fixtureData = await fixture()
  const { root, inputDirectory, outputDirectory, commit } = fixtureData
  const plan = await prepareReleasePlan({
    repositoryRoot: root,
    repository: "chaitin/MagicChat",
    tag: "desktop/nightly-1",
    commit,
    inputDirectory,
    outputDirectory,
  })
  assert.equal(plan.version, "2.0.0")
  assert.equal(plan.build, 20)
  assert.equal(plan.commit, commit)
  assert.deepEqual(
    plan.assets.map((asset) => asset.name),
    expectedReleaseAssetNames("2.0.0"),
  )
  assert.equal((await readdir(outputDirectory)).length, 6)
  assert.equal(
    JSON.parse(await readFile(path.join(outputDirectory, "release-plan.json"), "utf8")).tag,
    "desktop/nightly-1",
  )
})

test("拒绝不匹配的标签、提交和缺失的平台产物", async () => {
  const fixtureData = await fixture()
  const { root, inputDirectory, outputDirectory, commit } = fixtureData
  await assert.rejects(
    inspectReleaseTag({ tag: "desktop-v2.0.0", expectedCommit: commit, repository: root }),
  )
  await assert.rejects(
    inspectReleaseTag({
      tag: "desktop/nightly-1",
      expectedCommit: "0".repeat(40),
      repository: root,
    }),
  )
  await writeFile(path.join(inputDirectory, "extra.exe"), "unknown")
  await assert.rejects(
    prepareReleasePlan({
      repositoryRoot: root,
      repository: "chaitin/MagicChat",
      tag: "desktop/nightly-1",
      commit,
      inputDirectory,
      outputDirectory,
    }),
    /发布制品不匹配/,
  )
})

test("带发布说明的 annotated desktop 标签也可用于发布", async () => {
  const { root, commit } = await fixture()
  git(root, "tag", "-a", "desktop/release-2", "-m", "新版本说明")
  const release = await inspectReleaseTag({
    tag: "desktop/release-2",
    expectedCommit: commit,
    repository: root,
  })
  assert.equal(release.commit, commit)
  assert.equal(release.notes, "新版本说明")
})

test("拒绝伪造文件名但格式或架构不正确的安装包", async () => {
  const { root, inputDirectory, outputDirectory, commit } = await fixture()
  const linuxArm = expectedReleaseAssetNames("2.0.0").find((name) => name.includes("linux-arm64"))
  const bytes = Buffer.alloc(1024)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(bytes)
  bytes[5] = 1
  bytes.writeUInt16LE(0x3e, 18)
  await writeFile(path.join(inputDirectory, linuxArm), bytes)
  await assert.rejects(
    prepareReleasePlan({
      repositoryRoot: root,
      repository: "chaitin/MagicChat",
      tag: "desktop/nightly-1",
      commit,
      inputDirectory,
      outputDirectory,
    }),
    /格式或架构无效/,
  )
})
