import { readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileDigests, fileSha256, mapWithConcurrency } from "./release-tools.mjs"
import { ownerMarker } from "./github-release-adapter.mjs"

const ASSET_DIGEST_CONCURRENCY = 2

export async function publishReleaseTransaction({
  adapter,
  planPath,
  repository,
  runAttempt,
  runId,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const planDirectory = path.dirname(planPath)
  const plan = JSON.parse(await readFile(planPath, "utf8"))
  validatePlan(plan, repository)
  const owner = `${repository}/actions/runs/${runId}/attempts/${runAttempt}`
  const assets = await validateLocalAssets(planDirectory, plan.assets)
  const notes = await readSafeRelativeFile(planDirectory, plan.notes)
  if ((await fileSha256(safeRelativePath(planDirectory, plan.notes))) !== plan.notesSha256) {
    throw new Error("Release Notes SHA-256 与资产计划不一致")
  }
  const existing = await adapter.findByTag({ repository, tag: plan.tag })
  if (existing.length > 0) throw new Error(describeExistingRelease(existing[0]))
  const remoteCommit = await adapter.resolveTagCommit({ repository, tag: plan.tag })
  if (remoteCommit !== plan.commit) throw new Error("远端 Tag Commit 与资产计划不一致")

  let created
  let publishAttempted = false
  try {
    created = await adapter.createDraft({
      body: notes,
      commit: plan.commit,
      name: `即应 Desktop ${plan.version}`,
      owner,
      repository,
      tag: plan.tag,
    })
    assertReleaseIdentity(created, { draft: true, owner, tag: plan.tag })
    const state = { id: created.id, owner, repository, runAttempt, runId, tag: plan.tag }
    await writeFile(
      path.join(planDirectory, "release-transaction.json"),
      `${JSON.stringify(state, null, 2)}\n`,
    )
    for (const asset of assets) {
      await adapter.uploadAsset({
        filePath: asset.absolutePath,
        id: created.id,
        name: asset.name,
        repository,
      })
    }
    await verifyRemoteAssets({ adapter, assets, id: created.id, repository, sleep })
    publishAttempted = true
    await adapter.publish({ id: created.id, repository })
    const published = await adapter.getRelease({ id: created.id, repository })
    assertReleaseIdentity(published, { draft: false, owner, tag: plan.tag })
    if (published.prerelease) throw new Error("Release 公开后仍为 prerelease")
    return { assets: assets.length, id: created.id, owner, tag: plan.tag }
  } catch (error) {
    if (created && !publishAttempted) {
      const cleanup = await cleanupOwnedDraft({
        adapter,
        id: created.id,
        owner,
        repository,
        tag: plan.tag,
      })
      if (!cleanup.deleted) {
        throw new Error(
          `${error.message}\nDraft 未自动删除：${cleanup.reason}\n请按 Release ID ${created.id} 人工恢复。`,
        )
      }
    }
    if (created && publishAttempted) {
      throw new Error(
        `${error.message}\n公开操作已经发起，禁止自动删除 Release ID ${created.id}；请人工确认远端状态。`,
      )
    }
    throw error
  }
}

export async function cleanupOwnedDraft({ adapter, id, owner, repository, tag }) {
  let release
  try {
    release = await adapter.getRelease({ id, repository })
  } catch (error) {
    return { deleted: false, reason: `无法读取 Draft：${error.message}` }
  }
  try {
    assertReleaseIdentity(release, { draft: true, owner, tag })
  } catch (error) {
    return { deleted: false, reason: error.message }
  }
  try {
    await adapter.deleteDraft({ id, repository })
    return { deleted: true }
  } catch (error) {
    return { deleted: false, reason: `按 Release ID 清理失败：${error.message}` }
  }
}

async function verifyRemoteAssets({ adapter, assets, id, repository, sleep }) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const remote = await adapter.getAssets({ id, repository })
    const byName = new Map()
    for (const asset of remote) {
      if (byName.has(asset.name)) throw new Error(`远端资产名称重复：${asset.name}`)
      byName.set(asset.name, asset)
    }
    if (byName.size !== assets.length)
      throw new Error(`远端资产数量不一致：${byName.size} != ${assets.length}`)
    let waiting = false
    for (const local of assets) {
      const asset = byName.get(local.name)
      if (!asset) throw new Error(`远端缺少资产：${local.name}`)
      if (asset.size !== local.size) throw new Error(`远端资产大小不一致：${local.name}`)
      if (!asset.digest) waiting = true
      else if (asset.digest !== `sha256:${local.sha256}`)
        throw new Error(`远端 SHA-256 不一致：${local.name}`)
    }
    if (!waiting) return
    if (attempt < 11) await sleep(5000)
  }
  throw new Error("GitHub Asset digest 轮询超时")
}

async function validateLocalAssets(planDirectory, assets) {
  if (!Array.isArray(assets) || assets.length === 0) throw new Error("release-plan 缺少资产")
  const names = new Set()
  return mapWithConcurrency(assets, ASSET_DIGEST_CONCURRENCY, async (asset) => {
    if (!asset || typeof asset.name !== "string" || names.has(asset.name))
      throw new Error("release-plan 资产名称无效或重复")
    names.add(asset.name)
    const absolutePath = safeRelativePath(planDirectory, asset.path)
    const fileStat = await stat(absolutePath)
    if (!fileStat.isFile() || fileStat.size !== asset.size)
      throw new Error(`本地资产大小不一致：${asset.name}`)
    const digests = await fileDigests(absolutePath)
    if (digests.sha256 !== asset.sha256) throw new Error(`本地资产 SHA-256 不一致：${asset.name}`)
    if (digests.sha512 !== asset.sha512) throw new Error(`本地资产 SHA-512 不一致：${asset.name}`)
    return { ...asset, absolutePath }
  })
}

function validatePlan(plan, repository) {
  if (
    plan.schemaVersion !== 1 ||
    !Number.isSafeInteger(plan.build) ||
    plan.build <= 0 ||
    plan.repository !== repository ||
    !/^desktop-v\d+\.\d+\.\d+$/.test(plan.tag)
  ) {
    throw new Error("release-plan 元数据无效")
  }
  if (!/^[a-f0-9]{40}$/.test(plan.commit)) throw new Error("release-plan Commit 无效")
}

function assertReleaseIdentity(release, { draft, owner, tag }) {
  if (!release || !Number.isSafeInteger(release.id)) throw new Error("Release ID 无效")
  if (release.tag_name !== tag) throw new Error("Release Tag 与事务记录不一致")
  if (release.draft !== draft)
    throw new Error(draft ? "目标 Release 已不是 Draft" : "目标 Release 尚未公开")
  if (typeof release.body !== "string" || !release.body.includes(ownerMarker(owner))) {
    throw new Error("Release 不属于当前 workflow run")
  }
}

function describeExistingRelease(release) {
  return release.draft
    ? `同 Tag 已存在无法归属当前运行的 Draft Release ID ${release.id}`
    : `同 Tag 已存在公开 Release ID ${release.id}，禁止覆盖或删除`
}

async function readSafeRelativeFile(root, relativePath) {
  return readFile(safeRelativePath(root, relativePath), "utf8")
}

function safeRelativePath(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath !== path.basename(relativePath)) {
    throw new Error("release-plan 包含越界路径")
  }
  return path.join(root, relativePath)
}
