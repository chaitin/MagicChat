// @vitest-environment node

import { describe, expect, it } from "vitest"
import {
  compareStableVersions,
  desktopVersionKey,
  isAllowedDesktopManifestUrl,
  selectDesktopVersionEntry,
} from "@main/desktop-version-manifest"

const sha512 = Buffer.alloc(64, 0x5a).toString("base64")
const manifest = {
  windows: {
    build: 8,
    sha512,
    size: 1024,
    version: "1.8.0",
    url: "https://jiying.chat/releases/jiying.exe",
  },
  macos: {
    build: 8,
    sha512,
    size: 1024,
    version: "1.8.0",
    url: "https://jiying.chat/releases/jiying.dmg",
  },
  "linux-amd": {
    build: 8,
    sha512,
    size: 1024,
    version: "1.8.0",
    url: "https://jiying.chat/releases/jiying.amd.AppImage",
  },
  "linux-arm": {
    build: 8,
    sha512,
    size: 1024,
    version: "1.8.0",
    url: "https://jiying.chat/releases/jiying.arm.AppImage",
  },
}

describe("桌面 version.json", () => {
  it.each([
    ["win32", "x64", "windows"],
    ["darwin", "x64", "macos"],
    ["darwin", "arm64", "macos"],
    ["linux", "x64", "linux-amd"],
    ["linux", "arm64", "linux-arm"],
    ["win32", "arm64", undefined],
  ] as const)("映射 %s/%s 到 %s", (platform, arch, key) => {
    expect(desktopVersionKey(platform, arch)).toBe(key)
  })

  it("读取当前平台字段并拒绝不安全元数据", () => {
    expect(selectDesktopVersionEntry(manifest, "win32", "x64")).toEqual({
      build: manifest.windows.build,
      url: manifest.windows.url,
      version: manifest.windows.version,
    })
    for (const url of [
      "http://jiying.chat/releases/jiying.exe",
      "https://evil.example/Jiying-1.8.0-win-x64.exe",
      "https://user:pass@jiying.chat/releases/jiying.exe",
      "https://jiying.chat/releases/jiying.exe?mirror=evil",
      "https://jiying.chat/releases/jiying.exe#download",
      "https://github.com/other/MagicChat/releases/download/desktop-v1.8.0/Jiying-1.8.0-win-x64.exe",
      "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.8.0/Jiying-1.9.0-win-x64.exe",
    ]) {
      expect(() =>
        selectDesktopVersionEntry(
          { ...manifest, windows: { ...manifest.windows, url } },
          "win32",
          "x64",
        ),
      ).toThrow("url")
    }
    expect(() =>
      selectDesktopVersionEntry(
        { ...manifest, windows: { ...manifest.windows, version: "1.8.0-beta.1" } },
        "win32",
        "x64",
      ),
    ).toThrow("version")
  })

  it("只读取 build、version 和 url，忽略额外完整性字段", () => {
    expect(
      selectDesktopVersionEntry(
        {
          ...manifest,
          windows: {
            build: 8,
            sha512: "ignored",
            size: "ignored",
            url: manifest.windows.url,
            version: "1.8.0",
          },
        },
        "win32",
        "x64",
      ),
    ).toEqual({ build: 8, url: manifest.windows.url, version: "1.8.0" })
  })

  it("只接受官网固定的 manifest 地址和单一缓存参数", () => {
    expect(isAllowedDesktopManifestUrl("https://jiying.chat/releases/version.json")).toBe(true)
    expect(isAllowedDesktopManifestUrl("https://jiying.chat/releases/version.json?_=123")).toBe(
      true,
    )
    expect(isAllowedDesktopManifestUrl("https://evil.example/releases/version.json")).toBe(false)
    expect(
      isAllowedDesktopManifestUrl("https://jiying.chat/releases/version.json?_=123&next=evil"),
    ).toBe(false)
  })

  it("只按 Stable SemVer 判断升级与降级", () => {
    expect(compareStableVersions("1.10.0", "1.9.9")).toBe(1)
    expect(compareStableVersions("1.8.0", "1.8.0")).toBe(0)
    expect(compareStableVersions("1.7.9", "1.8.0")).toBe(-1)
    expect(() => compareStableVersions("1.8.0-beta.1", "1.8.0")).toThrow()
  })
})
