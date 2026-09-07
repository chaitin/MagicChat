import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const photoLibraryUsage =
  "即应需要访问您选择的照片，用于在聊天中发送图片，例如从相册选择产品截图并发送给联系人或群聊。"
const photoLibraryAddUsage =
  "即应需要将您主动保存的聊天图片写入相册，例如将联系人发送的图片保存到系统“照片”。"

test("iOS 相册权限文案说明具体用途和使用示例", async () => {
  const [appConfig, iosInfo] = await Promise.all([
    readFile(new URL("app.json", root), "utf8").then(JSON.parse),
    readFile(new URL("ios/app/Info.plist", root), "utf8"),
  ])
  const plugins = new Map(
    appConfig.expo.plugins
      .filter((plugin: unknown) => Array.isArray(plugin))
      .map(([name, options]: [string, Record<string, unknown>]) => [
        name,
        options,
      ])
  )

  assert.equal(
    appConfig.expo.ios.infoPlist.NSPhotoLibraryUsageDescription,
    photoLibraryUsage
  )
  assert.equal(
    appConfig.expo.ios.infoPlist.NSPhotoLibraryAddUsageDescription,
    photoLibraryAddUsage
  )
  assert.equal(
    plugins.get("expo-media-library")?.photosPermission,
    photoLibraryUsage
  )
  assert.equal(
    plugins.get("expo-media-library")?.savePhotosPermission,
    photoLibraryAddUsage
  )
  assert.equal(
    plugins.get("expo-image-picker")?.photosPermission,
    photoLibraryUsage
  )
  assert.match(
    iosInfo,
    new RegExp(
      `<key>NSPhotoLibraryUsageDescription</key>\\s*<string>${photoLibraryUsage}</string>`
    )
  )
  assert.match(
    iosInfo,
    new RegExp(
      `<key>NSPhotoLibraryAddUsageDescription</key>\\s*<string>${photoLibraryAddUsage}</string>`
    )
  )
})
