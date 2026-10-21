import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import type { UpdateInfo } from "../src/shared/desktop.ts"
import {
  downloadNativeUpdate,
  installOnNextMacQuit,
  loadNativeUpdater,
  validateNativeMetadata,
  type NativeUpdater,
} from "../src/main/update-native.ts"

const update: UpdateInfo = {
  platform: "windows",
  currentVersion: "2.3.1",
  currentBuildId: 26,
  latestVersion: "2.3.2",
  latestBuildId: 27,
  downloadUrl: "https://jiying.chat/releases/setup.exe",
  updateFeed: "https://jiying.chat/releases/desktop/2.3.2/",
  updateAvailable: true,
}

const fileInfo = (url: string) => ({ url, size: 100, sha512: `${"A".repeat(86)}==` })
const metadata = { version: "2.3.2", files: [fileInfo("setup.exe")] }

test("CommonJS updater is loaded lazily from the ESM default export", async () => {
  const namespace = await import("electron-updater")
  assert.equal(Object.hasOwn(namespace, "autoUpdater"), false)
  assert.equal(
    typeof Object.getOwnPropertyDescriptor(namespace.default, "autoUpdater")?.get,
    "function",
  )
  const updater = new EventEmitter()
  let reads = 0
  const module = new Proxy(namespace, {
    get(target, name, receiver) {
      if (name === "default")
        return {
          get autoUpdater() {
            reads++
            return updater
          },
        }
      return Reflect.get(target, name, receiver)
    },
  })
  assert.equal(reads, 0)
  const loaded = await loadNativeUpdater(async () => module)
  assert.equal(loaded, updater)
  assert.equal(reads, 1)
})

test("updater loading errors propagate to the manager", async () => {
  const error = new Error("updater module unavailable")
  await assert.rejects(
    loadNativeUpdater(async () => {
      throw error
    }),
    (value) => value === error,
  )
})

test("native updater uses the dynamic trusted feed and leaves Windows install manual", async () => {
  const emitter = new EventEmitter()
  const calls: string[] = []
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    disableDifferentialDownload: true,
    setFeedURL: (url: string) => calls.push(url),
    checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: metadata }),
    downloadUpdate: async () => {
      emitter.emit("download-progress", { transferred: 50, total: 100, percent: 50 })
      return ["/tmp/setup.exe"]
    },
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
  } as unknown as NativeUpdater
  const progress: number[] = []
  assert.equal(
    await downloadNativeUpdate(update, updater, (value) => {
      if (value.percent !== null) progress.push(value.percent)
    }),
    "/tmp/setup.exe",
  )
  assert.deepEqual(calls, [update.updateFeed])
  assert.deepEqual(progress, [50])
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.disableDifferentialDownload, false)
  assert.equal(updater.disableWebInstaller, true)
  assert.equal(emitter.listenerCount("download-progress"), 0)
})

test("macOS waits for Squirrel to stage its ZIP before reporting readiness", async () => {
  const systemUpdater = new EventEmitter()
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    disableDifferentialDownload: true,
    setFeedURL: () => undefined,
    checkForUpdates: async () => ({
      isUpdateAvailable: true,
      updateInfo: { version: "2.3.2", files: [fileInfo("update.zip")] },
    }),
    downloadUpdate: async () => {
      queueMicrotask(() => systemUpdater.emit("update-downloaded"))
      return ["/tmp/update.zip"]
    },
    on: () => undefined,
    off: () => undefined,
  } as unknown as NativeUpdater
  const macUpdate = { ...update, platform: "macos" as const }
  assert.equal(
    await downloadNativeUpdate(macUpdate, updater, () => undefined, systemUpdater as never),
    "/tmp/update.zip",
  )
  assert.equal(updater.autoInstallOnAppQuit, true)
  assert.equal(systemUpdater.listenerCount("update-downloaded"), 0)
})

test("natural macOS quit starts installation without reopening the app", () => {
  const application = new EventEmitter()
  const updater = {
    autoRunAppAfterInstall: true,
    quitAndInstall: () => {
      installs++
    },
  }
  let installs = 0
  const cancel = installOnNextMacQuit(application as never, updater as never)
  application.emit("before-quit")
  application.emit("before-quit")
  assert.equal(installs, 1)
  assert.equal(updater.autoRunAppAfterInstall, false)
  cancel()
  assert.equal(application.listenerCount("before-quit"), 0)
  const canceled = installOnNextMacQuit(application as never, updater as never)
  canceled()
  application.emit("before-quit")
  assert.equal(installs, 1)
})

test("metadata mismatch and remote file references cannot be installed", () => {
  assert.doesNotThrow(() => validateNativeMetadata(update, metadata))
  assert.throws(() => validateNativeMetadata(update, { ...metadata, version: "2.3.3" }))
  assert.throws(() =>
    validateNativeMetadata(update, { ...metadata, files: [{ url: "setup.exe" }] }),
  )
  for (const url of [
    "../setup.exe",
    "/setup.exe",
    "https://example.invalid/setup.exe",
    ".hidden.exe",
  ]) {
    assert.throws(() => validateNativeMetadata(update, { ...metadata, files: [fileInfo(url)] }))
  }
})
