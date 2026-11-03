import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hydrateReleaseDownloadLinks, releaseUrl } from "../src/lib/release-downloads.ts";

describe("官网发布下载地址", () => {
  it("只接受资源域名固定路径和受控仓库的版本化 Release 路径", () => {
    assert.equal(
      releaseUrl("https://assets.jiying.chat/releases/jiying.exe", "windows"),
      "https://assets.jiying.chat/releases/jiying.exe",
    );
    assert.equal(
      releaseUrl(
        "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.8.0/Jiying-1.8.0-win-x64.exe",
        "windows",
      ),
      "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.8.0/Jiying-1.8.0-win-x64.exe",
    );
  });

  it("区分 Linux AMD64 与 ARM64 的安装包", () => {
    const arm = "https://assets.jiying.chat/releases/jiying.arm.AppImage";
    const amd = "https://assets.jiying.chat/releases/jiying.amd.AppImage";
    const versioned = "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.8.0/Jiying-1.8.0-linux-arm64.AppImage";
    assert.equal(releaseUrl(arm, "linux-arm"), arm);
    assert.equal(releaseUrl(versioned, "linux-arm"), versioned);
    assert.equal(releaseUrl(amd, "linux-arm"), undefined);
    assert.equal(releaseUrl(arm, "linux-amd"), undefined);
    assert.equal(releaseUrl(versioned, "linux-amd"), undefined);
  });

  it("从发布清单更新 ARM64 下载入口并拒绝错误架构", async () => {
    const stable = "https://assets.jiying.chat/releases/jiying.arm.AppImage";
    const versioned = "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.8.0/Jiying-1.8.0-linux-arm64.AppImage";
    const link = { dataset: { releasePlatform: "linux-arm" }, href: stable };
    const root = { querySelectorAll: () => [link] };
    await hydrateReleaseDownloadLinks(root, async (url) => {
      assert.equal(url, "https://assets.jiying.chat/releases/version.json");
      return new Response(JSON.stringify({ "linux-arm": { url: versioned } }));
    });
    assert.equal(link.href, versioned);
    await hydrateReleaseDownloadLinks(root, async () => new Response(JSON.stringify({ "linux-arm": { url: "https://assets.jiying.chat/releases/jiying.amd.AppImage" } })));
    assert.equal(link.href, versioned);
  });

  it("拒绝任意 HTTPS 主机、跨平台路径、凭据、查询参数和片段", () => {
    for (const value of [
      "https://evil.example/Jiying-1.8.0-win-x64.exe",
      "https://jiying.chat/releases/jiying.exe",
      "https://assets.jiying.chat.evil.example/releases/jiying.exe",
      "https://assets.jiying.chat/releases/jiying.dmg",
      "https://user:pass@assets.jiying.chat/releases/jiying.exe",
      "https://assets.jiying.chat/releases/jiying.exe?mirror=evil",
      "https://assets.jiying.chat/releases/jiying.exe#download",
      "https://github.com/other/MagicChat/releases/download/desktop-v1.8.0/Jiying-1.8.0-win-x64.exe",
      "https://github.com/ptonlix/MagicChat/releases/download/desktop-v1.8.0/Jiying-1.9.0-win-x64.exe",
    ]) {
      assert.equal(releaseUrl(value, "windows"), undefined);
    }
  });
});
