import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rmdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import {
  fileDigests,
  fileSha256,
  fileSha512,
  linuxArtifactSuffixes,
  mapWithConcurrency,
} from "./release-tools.mjs"
import { createDesktopVersionFile, desktopPackageFileNames } from "./desktop-version-file.mjs"

export const RELEASE_TARGETS = ["win:x64", "win:arm64", "mac:universal", "linux:x64", "linux:arm64"]
const RELEASE_RELEVANT_ASSET =
  /(?:\.(?:AppImage|deb|dmg|exe|zip|blockmap)|^latest(?:-mac|-linux|-linux-arm64)?\.yml$)$/
const ASSET_DIGEST_CONCURRENCY = 2

export function parseReleaseInput(value) {
  const first = value.indexOf(":")
  const second = value.indexOf(":", first + 1)
  if (first <= 0 || second <= first + 1 || second === value.length - 1) {
    throw new Error(`发布输入格式无效：${value}`)
  }
  return {
    platform: value.slice(0, first),
    arch: value.slice(first + 1, second),
    directory: value.slice(second + 1),
  }
}

export function targetAssetModel(version, platform, arch) {
  const prefix = `Jiying-${version}`
  if (platform === "win" && ["x64", "arm64"].includes(arch)) {
    return { publicAssets: [`${prefix}-win-${arch}.exe`] }
  }
  if (platform === "mac" && arch === "universal") {
    return { publicAssets: [`${prefix}-mac-universal.dmg`] }
  }
  if (platform === "linux" && ["x64", "arm64"].includes(arch)) {
    const suffixes = linuxArtifactSuffixes(arch)
    return {
      publicAssets: [`${prefix}-${suffixes.appImage}`, `${prefix}-${suffixes.deb}`],
    }
  }
  throw new Error(`不支持的发布目标：${platform}/${arch}`)
}

export async function prepareReleaseAssets({
  build,
  commit,
  inputs,
  notes,
  outputDirectory,
  releaseDate,
  tag,
  version,
  versionBase,
}) {
  assertInputs(inputs)
  await assertOutputAvailable(outputDirectory)
  await mkdir(path.dirname(outputDirectory), { recursive: true })
  const staging = await mkdtemp(
    path.join(path.dirname(outputDirectory), ".magicchat-release-assets-"),
  )
  try {
    const copied = new Map()
    for (const input of inputs) {
      const model = targetAssetModel(version, input.platform, input.arch)
      await assertInputAssets(input.directory, model)
      for (const name of model.publicAssets) {
        await copyUnique(path.join(input.directory, name), path.join(staging, name), copied)
      }
    }
    const expected = expectedReleaseAssetNames(version)
    const packageNames = [...expected].filter((name) => name !== "version.json").sort()
    const packageAssets = await mapWithConcurrency(packageNames, ASSET_DIGEST_CONCURRENCY, (name) =>
      createReleaseAsset(staging, name),
    )
    const packageAssetsByName = new Map(packageAssets.map((asset) => [asset.name, asset]))
    const integrity = Object.fromEntries(
      Object.entries(desktopPackageFileNames(version)).map(([key, name]) => {
        const asset = packageAssetsByName.get(name)
        if (!asset) throw new Error(`缺少 Desktop 更新安装包：${name}`)
        return [key, { sha512: asset.sha512, size: asset.size }]
      }),
    )
    await writeFile(
      path.join(staging, "version.json"),
      `${JSON.stringify(createDesktopVersionFile(versionBase, { build, integrity, tag, version }), null, 2)}\n`,
    )
    await assertExactSet(staging, expected)
    const versionAsset = await createReleaseAsset(staging, "version.json")
    const assets = [...packageAssets, versionAsset].sort((left, right) =>
      left.name.localeCompare(right.name),
    )
    const appendix = generateReleaseAppendix({ version })
    const finalNotes = `${notes.trim()}\n\n---\n\n${appendix}\n`
    const notesPath = path.join(staging, "release-notes.md")
    await writeFile(notesPath, finalNotes)
    const plan = {
      schemaVersion: 1,
      assets,
      build,
      commit,
      notes: "release-notes.md",
      notesSha256: await fileSha256(notesPath),
      releaseDate,
      repository: "ptonlix/MagicChat",
      tag,
      version,
    }
    await writeFile(path.join(staging, "release-plan.json"), `${JSON.stringify(plan, null, 2)}\n`)
    const output = await lstat(outputDirectory).catch(() => undefined)
    if (output) await rmdir(outputDirectory)
    await rename(staging, outputDirectory)
    return { ...plan, outputDirectory }
  } catch (error) {
    await rm(staging, { force: true, recursive: true })
    throw error
  }
}

async function createReleaseAsset(directory, name) {
  const filePath = path.join(directory, name)
  const [digests, fileStat] = await Promise.all([fileDigests(filePath), stat(filePath)])
  return {
    name,
    path: name,
    ...digests,
    size: fileStat.size,
  }
}

export function expectedReleaseAssetNames(version) {
  const names = new Set(["version.json"])
  for (const target of RELEASE_TARGETS) {
    const [platform, arch] = target.split(":")
    for (const name of targetAssetModel(version, platform, arch).publicAssets) names.add(name)
  }
  return names
}

export function generateReleaseAppendix({ version }) {
  return `## 自动发布附录

### 支持与更新载体

- Windows x64/arm64：NSIS
- macOS Intel/Apple Silicon：Universal DMG
- Linux x64/arm64：AppImage；deb 用于手动安装与恢复

### 恢复说明

若 ${version} 无法完成应用内更新，请从同一公开 Release 下载与平台和架构匹配的完整安装包。旧版 MagicChat 的 macOS 用户需手动安装即应并移除旧应用程序。`
}

async function assertInputAssets(directory, model) {
  const names = await readdir(directory)
  const expected = new Set(model.publicAssets)
  const relevant = names.filter((name) => RELEASE_RELEVANT_ASSET.test(name))
  const missing = [...expected].filter((name) => !relevant.includes(name))
  const extra = relevant.filter((name) => !expected.has(name))
  if (missing.length || extra.length) {
    throw new Error(`目标资产集合不匹配：缺失 [${missing.join(", ")}], 额外 [${extra.join(", ")}]`)
  }
}

async function assertExactSet(directory, expected) {
  const actual = new Set(await readdir(directory))
  const missing = [...expected].filter((name) => !actual.has(name))
  const extra = [...actual].filter((name) => !expected.has(name))
  if (missing.length || extra.length)
    throw new Error(`最终资产集合不匹配：缺失 [${missing.join(", ")}], 额外 [${extra.join(", ")}]`)
}

function assertInputs(inputs) {
  const targets = inputs.map((input) => `${input.platform}:${input.arch}`)
  const unique = new Set(targets)
  const missing = RELEASE_TARGETS.filter((target) => !unique.has(target))
  const extra = targets.filter((target) => !RELEASE_TARGETS.includes(target))
  if (
    inputs.length !== RELEASE_TARGETS.length ||
    unique.size !== inputs.length ||
    missing.length ||
    extra.length
  ) {
    throw new Error(
      `发布输入必须恰好包含五个目标：缺失 [${missing.join(", ")}], 额外或重复 [${extra.join(", ")}]`,
    )
  }
}

async function assertOutputAvailable(outputDirectory) {
  const output = await lstat(outputDirectory).catch(() => undefined)
  if (!output) return
  if (!output.isDirectory() || (await readdir(outputDirectory)).length > 0) {
    throw new Error("发布资产输出目录必须不存在或为空")
  }
}

async function copyUnique(sourcePath, targetPath, copied) {
  const name = path.basename(targetPath)
  const digest = await fileSha512(sourcePath)
  const existing = copied.get(name)
  if (existing && existing !== digest) throw new Error(`矩阵产物发生同名内容冲突：${name}`)
  if (!existing) {
    await copyFile(sourcePath, targetPath)
    copied.set(name, digest)
  }
}
