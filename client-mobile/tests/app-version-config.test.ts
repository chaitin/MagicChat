import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)

test("原生平台版本与 Expo 配置保持一致", async () => {
  const [appConfig, androidGradle, iosProject, iosInfo] = await Promise.all([
    readFile(new URL("app.json", root), "utf8").then(JSON.parse),
    readFile(new URL("android/app/build.gradle", root), "utf8"),
    readFile(new URL("ios/app.xcodeproj/project.pbxproj", root), "utf8"),
    readFile(new URL("ios/app/Info.plist", root), "utf8"),
  ])

  assert.equal(appConfig.expo.version, "1.4.1")
  assert.equal(appConfig.expo.android.versionCode, 11)
  assert.equal(appConfig.expo.ios.buildNumber, "11")
  assert.match(androidGradle, /versionCode 11/)
  assert.match(androidGradle, /versionName "1\.4\.1"/)
  assert.equal(iosProject.match(/CURRENT_PROJECT_VERSION = 11;/g)?.length, 2)
  assert.equal(iosProject.match(/MARKETING_VERSION = 1\.4\.1;/g)?.length, 2)
  assert.match(iosInfo, /<key>CFBundleShortVersionString<\/key>\s*<string>1\.4\.1<\/string>/)
  assert.match(iosInfo, /<key>CFBundleVersion<\/key>\s*<string>11<\/string>/)
})
