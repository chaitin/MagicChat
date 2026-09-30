import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { ownerMarker, releaseTagRefPath } from "../github-release-adapter.mjs"
import { fileDigests, fileSha256 } from "../release-tools.mjs"
import { publishReleaseTransaction } from "../release-transaction.mjs"

test("带斜杠的桌面标签按完整引用路径查询", () => {
  assert.equal(
    releaseTagRefPath("chaitin/MagicChat", "desktop/nightly-1"),
    "repos/chaitin/MagicChat/git/ref/tags/desktop/nightly-1",
  )
})

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "desktop-release-transaction-"))
  const asset = path.join(directory, "package.exe")
  const notes = path.join(directory, "release-notes.md")
  await writeFile(asset, "installer")
  await writeFile(notes, "Release notes")
  const digests = await fileDigests(asset)
  const plan = {
    schemaVersion: 1,
    repository: "chaitin/MagicChat",
    tag: "desktop/nightly-1",
    commit: "a".repeat(40),
    version: "2.0.0",
    build: 20,
    notes: "release-notes.md",
    notesSha256: await fileSha256(notes),
    assets: [{ name: "package.exe", path: "package.exe", size: 9, ...digests }],
  }
  const planPath = path.join(directory, "release-plan.json")
  await writeFile(planPath, JSON.stringify(plan))
  return { plan, planPath }
}

function adapter(plan, options = {}) {
  const owner = "chaitin/MagicChat/actions/runs/123/attempts/1"
  const release = {
    id: 42,
    tag_name: plan.tag,
    draft: true,
    prerelease: false,
    body: ownerMarker(owner),
  }
  const calls = []
  return {
    calls,
    async findByTag() {
      return []
    },
    async resolveTagCommit() {
      return plan.commit
    },
    async createDraft() {
      calls.push("draft")
      return release
    },
    async uploadAsset() {
      calls.push("upload")
    },
    async getAssets() {
      return [
        {
          name: plan.assets[0].name,
          size: plan.assets[0].size,
          digest: options.badDigest ? "sha256:invalid" : `sha256:${plan.assets[0].sha256}`,
        },
      ]
    },
    async getRelease() {
      return release
    },
    async deleteDraft() {
      calls.push("delete")
    },
    async publish() {
      calls.push("publish")
      release.draft = false
    },
  }
}

test("仅在远端资产摘要复核通过后公开 Release", async () => {
  const { plan, planPath } = await fixture()
  const remote = adapter(plan)
  const result = await publishReleaseTransaction({
    adapter: remote,
    planPath,
    repository: plan.repository,
    runId: "123",
    runAttempt: "1",
  })
  assert.equal(result.id, 42)
  assert.deepEqual(remote.calls, ["draft", "upload", "publish"])
})

test("远端摘要错误时不公开 Release，且只删除本次创建的 Draft", async () => {
  const { plan, planPath } = await fixture()
  const remote = adapter(plan, { badDigest: true })
  await assert.rejects(
    publishReleaseTransaction({
      adapter: remote,
      planPath,
      repository: plan.repository,
      runId: "123",
      runAttempt: "1",
    }),
    /SHA-256/,
  )
  assert.deepEqual(remote.calls, ["draft", "upload", "delete"])
})
