import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)

test("原生平台版本与 Expo 配置保持一致", async () => {
  const [appConfig, mobilePackage, androidGradle, iosProject, iosInfo] = await Promise.all([
    readFile(new URL("app.json", root), "utf8").then(JSON.parse),
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("android/app/build.gradle", root), "utf8"),
    readFile(new URL("ios/app.xcodeproj/project.pbxproj", root), "utf8"),
    readFile(new URL("ios/app/Info.plist", root), "utf8"),
  ])

  assert.equal(appConfig.expo.version, "2.9.2")
  assert.equal(mobilePackage.version, appConfig.expo.version)
  assert.equal(appConfig.expo.android.versionCode, 35)
  assert.equal(appConfig.expo.ios.buildNumber, "35")
  assert.match(androidGradle, /versionCode 35/)
  assert.match(androidGradle, /versionName "2\.9\.2"/)
  // Expo writes literal versions to this plist; unused Xcode template defaults do not set the packaged version.
  assert.match(iosProject, /INFOPLIST_FILE = app\/Info\.plist;/)
  assert.match(iosInfo, /<key>CFBundleShortVersionString<\/key>\s*<string>2\.9\.2<\/string>/)
  assert.match(iosInfo, /<key>CFBundleVersion<\/key>\s*<string>35<\/string>/)
})
