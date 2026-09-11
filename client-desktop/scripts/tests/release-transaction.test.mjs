import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { ownerMarker } from "../github-release-adapter.mjs"
import { cleanupOwnedDraft, publishReleaseTransaction } from "../release-transaction.mjs"
import { fileSha256, fileSha512 } from "../release-tools.mjs"

describe("GitHub Draft 发布事务", () => {
  it("逐项上传、复核 digest 后公开同一 Release ID", async () => {
    const planPath = await createPlan()
    const adapter = mockAdapter()
    await expect(transaction(adapter, planPath)).resolves.toMatchObject({ assets: 1, id: 42 })
    expect(adapter.calls).toEqual([
      "find",
      "tag",
      "create",
      "upload:asset.exe",
      "assets",
      "publish:42",
      "release:42",
    ])
  })

  it.each([
    [{ draft: false, id: 7, tag_name: "desktop-v1.2.3" }, "公开 Release"],
    [{ draft: true, id: 8, tag_name: "desktop-v1.2.3" }, "无法归属"],
  ])("拒绝既有同 Tag Release", async (existing, message) => {
    const adapter = mockAdapter({ existing: [existing] })
    await expect(transaction(adapter, await createPlan())).rejects.toThrow(message)
    expect(adapter.calls).toEqual(["find"])
  })

  it("上传不完整或 digest 不一致时只按所有权匹配的 ID 清理", async () => {
    const adapter = mockAdapter({ digest: "sha256:bad" })
    await expect(transaction(adapter, await createPlan())).rejects.toThrow("SHA-256")
    expect(adapter.calls).toContain("delete:42")
    const unknown = mockAdapter({ releaseBody: "unknown" })
    await expect(transaction(unknown, await createPlan())).rejects.toThrow("未自动删除")
    expect(unknown.calls).not.toContain("delete:42")
  })

  it.each([
    [[], "数量"],
    [[{ digest: "sha256:any", name: "other.exe", size: 5 }], "缺少资产"],
    [[{ digest: "sha256:any", name: "asset.exe", size: 6 }], "大小"],
  ])("拒绝部分上传、名称或大小不一致", async (remoteAssets, message) => {
    const adapter = mockAdapter({ remoteAssets })
    await expect(transaction(adapter, await createPlan())).rejects.toThrow(message)
    expect(adapter.calls).toContain("delete:42")
  })

  it("并发创建 Draft 失败时不删除竞态产生的未知 Release", async () => {
    const adapter = mockAdapter({ createError: true })
    await expect(transaction(adapter, await createPlan())).rejects.toThrow("concurrent create")
    expect(adapter.calls).not.toContain("delete:42")
  })

  it("公开失败或公开后诊断失败时不自动删除", async () => {
    for (const options of [{ publishError: true }, { diagnoseError: true }]) {
      const adapter = mockAdapter(options)
      await expect(transaction(adapter, await createPlan())).rejects.toThrow("禁止自动删除")
      expect(adapter.calls).not.toContain("delete:42")
    }
  })

  it("清理失败时保留 Draft 并输出按 ID 恢复信息", async () => {
    const adapter = mockAdapter({ cleanupError: true })
    await expect(transaction(adapter, await createPlan(), true)).rejects.toThrow("Release ID 42")
    expect(
      await cleanupOwnedDraft({
        adapter,
        id: 42,
        owner: "ptonlix/MagicChat/actions/runs/100/attempts/1",
        repository: "ptonlix/MagicChat",
        tag: "desktop-v1.2.3",
      }),
    ).toMatchObject({ deleted: false })
  })
})

function mockAdapter(options = {}) {
  const calls = []
  const owner = "ptonlix/MagicChat/actions/runs/100/attempts/1"
  const release = {
    body: options.releaseBody ?? ownerMarker(owner),
    draft: true,
    id: 42,
    prerelease: false,
    tag_name: "desktop-v1.2.3",
  }
  return {
    calls,
    digest: options.digest,
    async createDraft() {
      calls.push("create")
      if (options.createError) throw new Error("concurrent create")
      return release
    },
    async deleteDraft({ id }) {
      calls.push(`delete:${id}`)
      if (options.cleanupError) throw new Error("cleanup failed")
    },
    async findByTag() {
      calls.push("find")
      return options.existing ?? []
    },
    async getAssets() {
      calls.push("assets")
      return (
        options.remoteAssets ?? [
          { digest: options.digest ?? undefined, name: "asset.exe", size: 5 },
        ]
      )
    },
    async getRelease({ id }) {
      calls.push(`release:${id}`)
      if (options.diagnoseError) throw new Error("diagnose failed")
      return options.published ? { ...release, draft: false } : release
    },
    async publish({ id }) {
      calls.push(`publish:${id}`)
      if (options.publishError) throw new Error("publish failed")
      options.published = true
    },
    async resolveTagCommit() {
      calls.push("tag")
      return "0123456789012345678901234567890123456789"
    },
    async uploadAsset({ name }) {
      calls.push(`upload:${name}`)
      if (options.uploadError) throw new Error("upload failed")
      if (!options.digest) {
        const plan = options.plan
        options.digest = plan ? `sha256:${plan.assets[0].sha256}` : undefined
      }
    },
  }
}

async function transaction(adapter, planPath, uploadError = false) {
  const plan = JSON.parse(await readFile(planPath, "utf8"))
  adapter.uploadAsset = async ({ name }) => {
    adapter.calls.push(`upload:${name}`)
    if (uploadError) throw new Error("upload failed")
    if (!adapter.digest) adapter.digest = `sha256:${plan.assets[0].sha256}`
  }
  const originalAssets = adapter.getAssets
  adapter.getAssets = async (...args) => {
    const result = await originalAssets(...args)
    return result.map((asset) => ({ ...asset, digest: adapter.digest ?? asset.digest }))
  }
  return publishReleaseTransaction({
    adapter,
    planPath,
    repository: "ptonlix/MagicChat",
    runAttempt: "1",
    runId: "100",
    sleep: async () => {},
  })
}

async function createPlan() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "magicchat-transaction-"))
  const assetPath = path.join(directory, "asset.exe")
  await writeFile(assetPath, "asset")
  await writeFile(path.join(directory, "release-notes.md"), "notes")
  const plan = {
    schemaVersion: 1,
    assets: [
      {
        name: "asset.exe",
        path: "asset.exe",
        sha256: await fileSha256(assetPath),
        sha512: await fileSha512(assetPath),
        size: 5,
      },
    ],
    build: 2,
    commit: "0123456789012345678901234567890123456789",
    notes: "release-notes.md",
    notesSha256: await fileSha256(path.join(directory, "release-notes.md")),
    repository: "ptonlix/MagicChat",
    tag: "desktop-v1.2.3",
    version: "1.2.3",
  }
  const planPath = path.join(directory, "release-plan.json")
  await writeFile(planPath, JSON.stringify(plan))
  return planPath
}
