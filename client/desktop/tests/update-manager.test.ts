import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { AuthFailure } from "../src/shared/auth.ts"
import { downloadNativeUpdate, installOnNextMacQuit } from "../src/main/update-native.ts"

function createManager(failure?: Error) {
  const file = ts.createSourceFile(
    "update-manager.ts",
    readFileSync(new URL("../src/main/update-manager.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  )
  const declaration = file.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === "UpdateManager",
  )!
  const compiled = ts.transpileModule(declaration.getText(file).replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const app = Object.assign(new EventEmitter(), { isPackaged: true })
  const systemUpdater = new EventEmitter()
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    autoRunAppAfterInstall: false,
    disableDifferentialDownload: true,
    disableWebInstaller: false,
    setFeedURL: () => undefined,
    checkForUpdates: async () => ({
      isUpdateAvailable: true,
      updateInfo: {
        version: "2.6.1",
        files: [{ url: "update.zip", size: 4, sha512: `${"A".repeat(86)}==` }],
      },
    }),
    downloadUpdate: async () => {
      queueMicrotask(() => systemUpdater.emit("update-downloaded"))
      return ["/tmp/update.zip"]
    },
    quitAndInstall: (...args: unknown[]) => {
      installs.push(args)
    },
  })
  const installs: unknown[][] = []
  const errors: unknown[][] = []
  let loads = 0
  const update = {
    platform: "macos",
    currentVersion: "2.6.0",
    currentBuildId: 30,
    latestVersion: "2.6.1",
    latestBuildId: 31,
    downloadUrl: "https://jiying.chat/releases/update.dmg",
    updateFeed: "https://jiying.chat/releases/",
    updateAvailable: true,
  }
  const factory = new Function(
    "app",
    "macSystemUpdater",
    "AuthFailure",
    "checkForUpdates",
    "loadNativeUpdater",
    "downloadNativeUpdate",
    "installOnNextMacQuit",
    "stat",
    "validateUpdateFile",
    "console",
    `${compiled}; return UpdateManager`,
  )
  const Manager = factory(
    app,
    systemUpdater,
    AuthFailure,
    async () => update,
    async () => {
      loads++
      if (failure) throw failure
      return updater
    },
    downloadNativeUpdate,
    installOnNextMacQuit,
    async () => ({ size: 4 }),
    async () => true,
    { error: (...args: unknown[]) => errors.push(args) },
  )
  return {
    manager: new Manager("/tmp/updates", () => undefined),
    updater,
    errors,
    installs,
    app,
    update,
    get loads() {
      return loads
    },
  }
}

test("mac manager downloads and restarts using the same lazily loaded updater", async () => {
  const fixture = createManager()
  await fixture.manager.check()
  await fixture.manager.download()
  assert.equal(fixture.loads, 1)
  assert.equal(fixture.updater.autoInstallOnAppQuit, true)
  await fixture.manager.restartToInstall()
  assert.equal(fixture.loads, 2)
  assert.equal(fixture.updater.autoRunAppAfterInstall, true)
  assert.deepEqual(fixture.installs, [[false, true]])
  assert.equal(fixture.app.listenerCount("before-quit"), 0)
})

test("mac manager clears staged installation when the available release disappears", async () => {
  const fixture = createManager()
  await fixture.manager.check()
  await fixture.manager.download()
  fixture.update.updateAvailable = false
  fixture.manager.checkedAt = 0
  await fixture.manager.check()
  assert.equal(fixture.loads, 2)
  assert.equal(fixture.updater.autoInstallOnAppQuit, false)
  assert.equal(fixture.app.listenerCount("before-quit"), 0)
})

test("failures before updater listeners are installed still log the original error", async () => {
  const error = new TypeError("updater import failed before listeners")
  const fixture = createManager(error)
  await fixture.manager.check()
  await assert.rejects(
    fixture.manager.download(),
    (value: unknown) => value instanceof AuthFailure && value.code === "update_download_failed",
  )
  assert.equal(fixture.updater.listenerCount("error"), 0)
  assert.deepEqual(fixture.errors, [["下载更新失败", error]])
})
