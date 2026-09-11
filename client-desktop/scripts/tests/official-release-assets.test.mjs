import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { prepareOfficialReleaseAssets } from "../official-release-assets.mjs"

describe("官网手工上传资产", () => {
  it("将版本化全量包改为官网固定文件名并输出三字段清单", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magicchat-official-assets-"))
    const input = path.join(root, "release")
    const output = path.join(root, "official")
    await mkdir(input)
    const version = "1.8.0"
    const files = {
      windows: `Jiying-${version}-win-x64.exe`,
      macos: `Jiying-${version}-mac-universal.dmg`,
      "linux-amd": `Jiying-${version}-linux-x86_64.AppImage`,
      "linux-arm": `Jiying-${version}-linux-arm64.AppImage`,
    }
    for (const name of Object.values(files)) await writeFile(path.join(input, name), name)
    const prefix = `https://github.com/ptonlix/MagicChat/releases/download/desktop-v${version}`
    await writeFile(
      path.join(input, "version.json"),
      JSON.stringify({
        android: { build: 10, version: "1.4.0", url: "https://jiying.chat/releases/jiying.apk" },
        ios: { build: 1, version: "1.0.0", url: "https://jiying.chat/releases/jiying.dmg" },
        ...Object.fromEntries(
          Object.entries(files).map(([key, name]) => [
            key,
            {
              build: 18,
              sha512: createHash("sha512").update(name).digest("base64"),
              size: Buffer.byteLength(name),
              version,
              url: `${prefix}/${name}`,
            },
          ]),
        ),
      }),
    )

    await prepareOfficialReleaseAssets({ inputDirectory: input, outputDirectory: output })

    expect((await readdir(output)).sort()).toEqual([
      "SHA256SUMS.txt",
      "jiying.amd.AppImage",
      "jiying.arm.AppImage",
      "jiying.dmg",
      "jiying.exe",
      "version.json",
    ])
    const manifest = JSON.parse(await readFile(path.join(output, "version.json"), "utf8"))
    expect(manifest.android.url).toBe("https://jiying.chat/releases/jiying.apk")
    expect(manifest.windows).toEqual({
      build: 18,
      url: "https://jiying.chat/releases/jiying.exe",
      version,
    })
    expect(await readFile(path.join(output, "SHA256SUMS.txt"), "utf8")).toContain(
      "jiying.arm.AppImage",
    )

    await writeFile(path.join(input, files.windows), "tampered-package")
    await expect(
      prepareOfficialReleaseAssets({
        inputDirectory: input,
        outputDirectory: path.join(root, "official-tampered"),
      }),
    ).rejects.toThrow("完整性不匹配")
  })
})
