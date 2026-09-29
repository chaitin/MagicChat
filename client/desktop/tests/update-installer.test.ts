import assert from "node:assert/strict"
import type { ChildProcess, spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import test from "node:test"
import { openDownloadedUpdate } from "../src/main/update-installer.ts"

test("Windows launches the installer before quitting", async () => {
  const calls: string[] = []
  const spawnInstaller = ((file: string) => {
    calls.push(`spawn:${file}`)
    const child = new EventEmitter() as ChildProcess
    child.unref = () => calls.push("unref")
    queueMicrotask(() => child.emit("spawn"))
    return child
  }) as typeof spawn
  await openDownloadedUpdate({
    platform: "windows",
    filePath: "C:/updates/setup.exe",
    spawnInstaller,
    openPath: async () => "",
    showItemInFolder: () => undefined,
    quit: () => calls.push("quit"),
  })
  assert.deepEqual(calls, ["spawn:C:/updates/setup.exe", "unref", "quit"])
})

test("Windows keeps the app running if the installer cannot launch", async () => {
  let quit = false
  const spawnInstaller = (() => {
    const child = new EventEmitter() as ChildProcess
    queueMicrotask(() => child.emit("error", new Error("launch failed")))
    return child
  }) as typeof spawn
  await assert.rejects(
    openDownloadedUpdate({
      platform: "windows",
      filePath: "C:/updates/setup.exe",
      spawnInstaller,
      openPath: async () => "",
      showItemInFolder: () => undefined,
      quit: () => {
        quit = true
      },
    }),
    /launch failed/,
  )
  assert.equal(quit, false)
})

test("macOS opens the DMG; Linux reveals rather than executes the AppImage", async () => {
  const calls: string[] = []
  const common = {
    filePath: "/tmp/Jiying-Update",
    openPath: async () => {
      calls.push("open")
      return ""
    },
    showItemInFolder: () => calls.push("reveal"),
    quit: () => calls.push("quit"),
  }
  await openDownloadedUpdate({ ...common, platform: "macos" })
  await openDownloadedUpdate({ ...common, platform: "linux-amd" })
  assert.deepEqual(calls, ["open", "reveal"])
  await assert.rejects(
    openDownloadedUpdate({ ...common, platform: "macos", openPath: async () => "denied" }),
    /denied/,
  )
})
