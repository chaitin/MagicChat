import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { downloadUpdatePackage, validateUpdateFile } from "../src/main/update-download.ts"
import type { UpdateInfo } from "../src/shared/desktop.ts"

const bytes = Buffer.alloc(256)
bytes.write("MZ")
bytes.writeUInt32LE(128, 60)
bytes.write("PE\0\0", 128)

const update: UpdateInfo = {
  platform: "windows",
  currentVersion: "2.0.0",
  currentBuildId: 20,
  latestVersion: "2.0.1",
  latestBuildId: 21,
  downloadUrl: "https://jiying.chat/releases/jiying.exe",
  updateAvailable: true,
}

function fakeResponse(body: Uint8Array, length: number | null = body.length, redirected = false) {
  const response = new Response(Uint8Array.from(body).buffer, {
    headers: length === null ? {} : { "content-length": String(length) },
  })
  Object.defineProperty(response, "redirected", { value: redirected })
  return response
}

test("downloads an installer when Electron net.fetch leaves response.url empty", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jiying-update-test-"))
  try {
    let fetches = 0
    const progress: Array<number | null> = []
    const options = {
      update,
      directory,
      fetcher: async (url: string, init: RequestInit) => {
        assert.equal(url, update.downloadUrl)
        assert.equal(init.redirect, "error")
        fetches++
        return fakeResponse(bytes)
      },
      onProgress: (event: { percent: number | null }) => progress.push(event.percent),
    }
    const { filePath, size } = await downloadUpdatePackage(options)
    assert.deepEqual(await readFile(filePath), bytes)
    assert.equal(size, bytes.length)
    assert.equal(await validateUpdateFile(filePath, "windows", size), true)
    assert.equal(progress.at(-1), 100)
    await downloadUpdatePackage(options)
    assert.equal(fetches, 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("downloads even without Content-Length, leaving progress indeterminate until completion", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jiying-update-test-"))
  try {
    const progress: Array<number | null> = []
    const { filePath } = await downloadUpdatePackage({
      update,
      directory,
      fetcher: async () => fakeResponse(bytes, null),
      onProgress: (event) => progress.push(event.percent),
    })
    assert.equal(await validateUpdateFile(filePath, "windows"), true)
    assert.deepEqual(progress, [null, 100])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects malformed, incomplete and redirected responses without installer leftovers", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jiying-update-test-"))
  try {
    const base = { update, directory, onProgress: () => undefined }
    await assert.rejects(
      downloadUpdatePackage({
        ...base,
        fetcher: async () => fakeResponse(Buffer.alloc(bytes.length)),
      }),
      /格式不正确/,
    )
    await assert.rejects(
      downloadUpdatePackage({
        ...base,
        fetcher: async () => fakeResponse(bytes, bytes.length + 1),
      }),
      /下载不完整/,
    )
    await assert.rejects(
      downloadUpdatePackage({
        ...base,
        fetcher: async () => fakeResponse(bytes, bytes.length, true),
      }),
      /下载失败/,
    )
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("recognizes macOS DMG and Linux AppImage package headers", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jiying-update-test-"))
  try {
    const dmg = Buffer.alloc(1024)
    dmg.write("koly", 512)
    const dmgPath = path.join(directory, "update.dmg")
    await writeFile(dmgPath, dmg)
    assert.equal(await validateUpdateFile(dmgPath, "macos"), true)
    assert.equal(await validateUpdateFile(dmgPath, "linux-amd"), false)

    const appImage = Buffer.alloc(64)
    appImage.set([0x7f, 0x45, 0x4c, 0x46], 0)
    appImage.write("AI", 8)
    appImage[10] = 2
    const appImagePath = path.join(directory, "update.AppImage")
    await writeFile(appImagePath, appImage)
    assert.equal(await validateUpdateFile(appImagePath, "linux-arm"), true)
    assert.equal(await validateUpdateFile(appImagePath, "linux-arm", 65), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
