import { copyFile, lstat, mkdir, open, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { fileDigests, fileSha256 } from "./release-tools.mjs"
import { inspectReleaseTag } from "./release-tag.mjs"

export function expectedReleaseAssetNames(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("客户端版本不是稳定 SemVer")
  const prefix = `Jiying-Desktop-Preview-${version}`
  return [
    `${prefix}-win-x64.exe`,
    `${prefix}-linux-x86_64.AppImage`,
    `${prefix}-linux-arm64.AppImage`,
    `${prefix}-mac-universal.dmg`,
    `${prefix}-mac-universal.zip`,
    `${prefix}-win-x64.exe.blockmap`,
    `${prefix}-mac-universal.zip.blockmap`,
    "latest.yml",
    "latest-mac.yml",
  ]
}

export async function prepareReleasePlan({
  repositoryRoot,
  repository,
  tag,
  commit,
  inputDirectory,
  outputDirectory,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("GitHub 仓库名称无效")
  const release = await inspectReleaseTag({
    tag,
    expectedCommit: commit,
    repository: repositoryRoot,
  })
  const metadata = JSON.parse(
    await readFile(path.join(repositoryRoot, "client/desktop/package.json"), "utf8"),
  )
  if (!Number.isSafeInteger(metadata.buildId) || metadata.buildId <= 0) {
    throw new Error("客户端 buildId 无效")
  }
  const expected = expectedReleaseAssetNames(metadata.version)
  const actual = (await readdir(inputDirectory)).filter((name) =>
    /\.(exe|dmg|zip|blockmap|AppImage|yml)$/i.test(name),
  )
  if (actual.length !== expected.length || actual.some((name) => !expected.includes(name))) {
    throw new Error(`发布制品不匹配：预期 [${expected.join(", ")}]，实际 [${actual.join(", ")}]`)
  }
  const files = await Promise.all(
    expected.map(async (name) => {
      const source = path.join(inputDirectory, name)
      const state = await lstat(source)
      if (!state.isFile() || state.size <= 0) throw new Error(`发布制品无效：${name}`)
      await verifyPackageHeader(source, name, state.size)
      return { name, source }
    }),
  )
  await verifyUpdateMetadata(inputDirectory, "latest.yml", expected[0], metadata.version)
  await verifyUpdateMetadata(inputDirectory, "latest-mac.yml", expected[4], metadata.version)
  await mkdir(outputDirectory)
  const assets = []
  for (const { name, source } of files) {
    const destination = path.join(outputDirectory, name)
    await copyFile(source, destination)
    assets.push({
      name,
      path: name,
      size: (await lstat(destination)).size,
      ...(await fileDigests(destination)),
    })
  }
  await writeFile(path.join(outputDirectory, "release-notes.md"), `${release.notes}\n`)
  const plan = {
    schemaVersion: 1,
    tag: release.tag,
    commit: release.commit,
    version: metadata.version,
    build: metadata.buildId,
    repository,
    notes: "release-notes.md",
    notesSha256: await fileSha256(path.join(outputDirectory, "release-notes.md")),
    assets,
  }
  await writeFile(
    path.join(outputDirectory, "release-plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
  )
  return plan
}

async function verifyUpdateMetadata(directory, metadataName, artifactName, version) {
  const metadata = parseYaml(await readFile(path.join(directory, metadataName), "utf8"))
  if (
    metadata?.version !== version ||
    !Array.isArray(metadata.files) ||
    metadata.files.some(
      (file) => typeof file?.url !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.url),
    )
  ) {
    throw new Error(`更新元数据版本或文件列表不正确：${metadataName}`)
  }
  const file = metadata.files.find((entry) => entry?.url === artifactName)
  const artifact = path.join(directory, artifactName)
  const { size } = await lstat(artifact)
  const { sha512 } = await fileDigests(artifact)
  if (file?.size !== size || file?.sha512 !== sha512) {
    throw new Error(`更新元数据摘要或大小不正确：${metadataName}`)
  }
}

async function verifyPackageHeader(source, name, size) {
  const handle = await open(source, "r")
  try {
    const header = Buffer.alloc(20)
    if ((await handle.read(header, 0, header.length, 0)).bytesRead !== header.length) {
      throw new Error(`发布制品头部无效：${name}`)
    }
    if (name.endsWith(".exe") && header.toString("ascii", 0, 2) === "MZ") return
    if (
      name.endsWith(".zip") &&
      header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    )
      return
    if (name.endsWith(".blockmap") && header.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])))
      return
    if (name.endsWith(".yml")) return
    if (name.endsWith(".AppImage")) {
      const arch = name.includes("-arm64.") ? 0xb7 : 0x3e
      if (
        header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) &&
        header[5] === 1 &&
        header.readUInt16LE(18) === arch
      )
        return
    }
    if (name.endsWith(".dmg") && size >= 512) {
      const footer = Buffer.alloc(4)
      if (
        (await handle.read(footer, 0, 4, size - 512)).bytesRead === 4 &&
        footer.toString("ascii") === "koly"
      )
        return
    }
    throw new Error(`发布制品格式或架构无效：${name}`)
  } finally {
    await handle.close()
  }
}
