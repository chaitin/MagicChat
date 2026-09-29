import assert from "node:assert/strict"
import test from "node:test"
import { parseUpdateInfo, releasePlatform } from "../src/main/update-policy.ts"

const manifest = {
  windows: {
    build: 21,
    version: "2.0.1",
    url: "https://jiying.chat/releases/jiying.exe",
  },
}

test("selects the current OS and compares its build ID", () => {
  assert.equal(releasePlatform("win32", "x64"), "windows")
  assert.equal(releasePlatform("darwin", "arm64"), "macos")
  assert.equal(releasePlatform("linux", "x64"), "linux-amd")
  assert.equal(releasePlatform("linux", "arm64"), "linux-arm")
  assert.throws(() => releasePlatform("win32", "ia32"))
  assert.deepEqual(parseUpdateInfo(manifest, "windows", "2.0.0", 20), {
    platform: "windows",
    currentVersion: "2.0.0",
    currentBuildId: 20,
    latestVersion: "2.0.1",
    latestBuildId: 21,
    downloadUrl: manifest.windows.url,
    updateAvailable: true,
  })
})

test("older builds do not trigger an update", () => {
  const info = parseUpdateInfo(
    { windows: { build: 3, version: "1.8.7", url: manifest.windows.url } },
    "windows",
    "2.0.0",
    20,
  )
  assert.equal(info.updateAvailable, false)
})

test("new builds require only build, version and a trusted platform URL", () => {
  const invalid = (patch: Record<string, unknown>) =>
    parseUpdateInfo({ windows: { ...manifest.windows, ...patch } }, "windows", "2.0.0", 20)
  assert.throws(() => invalid({ version: "" }))
  assert.throws(() => invalid({ url: "https://jiying.chat/releases/update.dmg" }))
  assert.throws(() => invalid({ url: "https://jiying.chat/releases/jiying.exe?url=evil" }))
  assert.throws(() => invalid({ url: "https://other.example/releases/jiying.exe" }))
})
