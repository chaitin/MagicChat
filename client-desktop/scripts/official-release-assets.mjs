import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileSha256, fileSha512 } from "./release-tools.mjs"
import { validateVersionFile } from "./desktop-version-file.mjs"

const OFFICIAL_URLS = {
  windows: "https://jiying.chat/releases/jiying.exe",
  macos: "https://jiying.chat/releases/jiying.dmg",
  "linux-amd": "https://jiying.chat/releases/jiying.amd.AppImage",
  "linux-arm": "https://jiying.chat/releases/jiying.arm.AppImage",
}

export async function prepareOfficialReleaseAssets({ inputDirectory, outputDirectory }) {
  const inputManifest = validateVersionFile(
    JSON.parse(await readFile(path.join(inputDirectory, "version.json"), "utf8")),
  )
  await mkdir(path.dirname(outputDirectory), { recursive: true })
  const outputState = await stat(outputDirectory).catch(() => undefined)
  if (outputState) throw new Error("官网上传目录必须不存在")
  const staging = await mkdtemp(path.join(path.dirname(outputDirectory), ".magicchat-official-"))
  try {
    const officialManifest = structuredClone(inputManifest)
    const copied = []
    for (const [key, officialUrl] of Object.entries(OFFICIAL_URLS)) {
      const entry = inputManifest[key]
      const sourceName = path.basename(new URL(entry.url).pathname)
      const sourcePath = path.join(inputDirectory, sourceName)
      const sourceState = await stat(sourcePath).catch(() => undefined)
      if (!sourceState?.isFile() || sourceState.size <= 0) {
        throw new Error(`缺少官网全量安装包：${sourceName}`)
      }
      if (sourceState.size !== entry.size || (await fileSha512(sourcePath)) !== entry.sha512) {
        throw new Error(`官网全量安装包完整性不匹配：${sourceName}`)
      }
      const targetName = path.basename(new URL(officialUrl).pathname)
      await copyFile(sourcePath, path.join(staging, targetName))
      officialManifest[key] = {
        build: entry.build,
        url: officialUrl,
        version: entry.version,
      }
      copied.push(targetName)
    }
    validateVersionFile(officialManifest)
    await writeFile(
      path.join(staging, "version.json"),
      `${JSON.stringify(officialManifest, null, 2)}\n`,
    )
    const checksums = []
    for (const name of [...copied, "version.json"].sort()) {
      checksums.push(`${await fileSha256(path.join(staging, name))}  ${name}`)
    }
    await writeFile(path.join(staging, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`)
    await rename(staging, outputDirectory)
    return { files: [...copied, "version.json", "SHA256SUMS.txt"], outputDirectory }
  } catch (error) {
    await rm(staging, { force: true, recursive: true })
    throw error
  }
}
