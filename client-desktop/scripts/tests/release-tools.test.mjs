import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import {
  fileDigests,
  linuxArtifactSuffixes,
  mapWithConcurrency,
  parseDesktopTag,
} from "../release-tools.mjs"

const execute = promisify(execFile)

describe("Desktop Stable 发布工具", () => {
  it("可被真实 Node ESM 直接加载", async () => {
    const moduleUrl = pathToFileURL(path.resolve(import.meta.dirname, "../release-tools.mjs"))
    await expect(
      execute(process.execPath, [
        "--input-type=module",
        "--eval",
        `await import(${JSON.stringify(moduleUrl.href)})`,
      ]),
    ).resolves.toBeDefined()
  })

  it("流式读取文件并在一次遍历中生成双摘要", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "jiying-release-"))
    const filePath = path.join(directory, "large-asset.bin")
    const content = Buffer.alloc(256 * 1024 + 17, 0x5a)
    await writeFile(filePath, content)

    await expect(fileDigests(filePath)).resolves.toEqual({
      sha256: createHash("sha256").update(content).digest("hex"),
      sha512: createHash("sha512").update(content).digest("base64"),
    })
  })

  it("有界并发映射保持结果顺序并限制同时执行数量", async () => {
    let active = 0
    let maximum = 0
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1
      maximum = Math.max(maximum, active)
      await Promise.resolve()
      active -= 1
      return value * 2
    })

    expect(results).toEqual([2, 4, 6, 8, 10])
    expect(maximum).toBe(2)
  })

  it("只接受严格的 Stable Tag", () => {
    expect(parseDesktopTag("desktop-v1.2.3")).toBe("1.2.3")
    for (const tag of [
      "v1.2.3",
      "desktop-v01.2.3",
      "desktop-v1.2",
      "desktop-v1.2.3-rc.1",
      "desktop-v1.2.3+build",
    ]) {
      expect(() => parseDesktopTag(tag)).toThrow()
    }
  })

  it("映射 electron-builder 的 Linux 平台原生架构名", () => {
    expect(linuxArtifactSuffixes("x64")).toEqual({
      appImage: "linux-x86_64.AppImage",
      deb: "linux-amd64.deb",
    })
    expect(linuxArtifactSuffixes("arm64")).toEqual({
      appImage: "linux-arm64.AppImage",
      deb: "linux-arm64.deb",
    })
    expect(() => linuxArtifactSuffixes("ia32")).toThrow("不支持的 Linux 制品架构")
  })
})
