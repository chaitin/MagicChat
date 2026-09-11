import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  expectedReleaseAssetNames,
  parseReleaseInput,
  prepareReleaseAssets,
  targetAssetModel,
} from "../release-assets.mjs"

const release = {
  build: 42,
  commit: "0123456789012345678901234567890123456789",
  notes: "即应 Desktop 1.2.3\n\n## 版本亮点\n\n- 更安全。",
  releaseDate: "2026-07-24T00:00:00.000Z",
  tag: "desktop-v1.2.3",
  version: "1.2.3",
  versionBase: {
    android: { build: 10, version: "1.4.0", url: "https://jiying.chat/releases/jiying.apk" },
    ios: { build: 1, version: "1.0.0", url: "https://jiying.chat/releases/jiying.dmg" },
    windows: { build: 1, version: "1.0.0", url: "https://jiying.chat/releases/jiying.exe" },
    macos: { build: 1, version: "1.0.0", url: "https://jiying.chat/releases/jiying.dmg" },
    "linux-amd": {
      build: 1,
      version: "1.0.0",
      url: "https://jiying.chat/releases/jiying.amd.AppImage",
    },
    "linux-arm": {
      build: 1,
      version: "1.0.0",
      url: "https://jiying.chat/releases/jiying.arm.AppImage",
    },
  },
}

describe("确定性发布资产计划", () => {
  it("兼容 Windows、macOS 与 Linux 输入路径格式", () => {
    expect(parseReleaseInput("win:x64:C:\\runner temp\\artifacts")).toEqual({
      arch: "x64",
      directory: "C:\\runner temp\\artifacts",
      platform: "win",
    })
    expect(parseReleaseInput("mac:universal:/Users/runner/artifacts").directory).toBe(
      "/Users/runner/artifacts",
    )
  })

  it("只生成七个完整安装包和 version.json", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jiying-assets-"))
    const inputs = await createInputs(root)
    const output = path.join(root, "release")
    await prepareReleaseAssets({ ...release, inputs, outputDirectory: output })
    const plan = JSON.parse(await readFile(path.join(output, "release-plan.json"), "utf8"))

    expect(plan.build).toBe(42)
    expect(new Set(plan.assets.map((asset) => asset.name))).toEqual(
      expectedReleaseAssetNames("1.2.3"),
    )
    expect(plan.assets).toHaveLength(8)
    expect(plan.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256) && asset.sha512)).toBe(
      true,
    )
    const names = await readdir(output)
    expect(names.some((name) => name.endsWith(".zip"))).toBe(false)
    expect(names.some((name) => name.endsWith(".blockmap"))).toBe(false)
    expect(names.some((name) => /^latest.*\.yml$/.test(name))).toBe(false)
    const versionFile = JSON.parse(await readFile(path.join(output, "version.json"), "utf8"))
    expect(versionFile.windows).toEqual({
      build: 42,
      sha512: expect.any(String),
      size: expect.any(Number),
      version: "1.2.3",
      url: "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.2.3/Jiying-1.2.3-win-x64.exe",
    })
    const windowsPackage = await readFile(path.join(output, "Jiying-1.2.3-win-x64.exe"))
    expect(versionFile.windows.size).toBe(windowsPackage.byteLength)
    expect(versionFile.windows.sha512).toBe(
      createHash("sha512").update(windowsPackage).digest("base64"),
    )
  })

  it("拒绝缺失、额外、重复目标、旧版更新清单和陈旧输出", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jiying-assets-invalid-"))
    const inputs = await createInputs(root)
    await writeFile(path.join(inputs[0].directory, "latest.yml"), "version: 1.2.3")
    await expect(
      prepareReleaseAssets({ ...release, inputs, outputDirectory: path.join(root, "legacy") }),
    ).rejects.toThrow("额外")

    const cleanInputs = await createInputs(path.join(root, "clean"))
    await expect(
      prepareReleaseAssets({
        ...release,
        inputs: cleanInputs.slice(0, 4),
        outputDirectory: path.join(root, "missing"),
      }),
    ).rejects.toThrow("五个目标")
    await expect(
      prepareReleaseAssets({
        ...release,
        inputs: [...cleanInputs.slice(0, 4), cleanInputs[0]],
        outputDirectory: path.join(root, "duplicate"),
      }),
    ).rejects.toThrow("重复")
    const stale = path.join(root, "stale")
    await mkdir(stale)
    await writeFile(path.join(stale, "old.exe"), "old")
    await expect(
      prepareReleaseAssets({ ...release, inputs: cleanInputs, outputDirectory: stale }),
    ).rejects.toThrow("必须不存在或为空")
  })
})

async function createInputs(root) {
  await mkdir(root, { recursive: true })
  const inputs = []
  for (const target of ["win:x64", "win:arm64", "mac:universal", "linux:x64", "linux:arm64"]) {
    const [platform, arch] = target.split(":")
    const directory = path.join(root, `${platform}-${arch}`)
    await mkdir(directory)
    const model = targetAssetModel("1.2.3", platform, arch)
    for (const name of model.publicAssets) {
      await writeFile(path.join(directory, name), `${target}:${name}`)
    }
    inputs.push({ arch, directory, platform })
  }
  return inputs
}
