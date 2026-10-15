import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import {
  createPushPresenceReporter,
  PUSH_PRESENCE_HEARTBEAT_MS,
} from "../../shared/push-presence.ts"

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

test("活跃上报串行化，前台请求不会晚于随后的后台或退出请求", async () => {
  const calls: boolean[] = []
  let complete!: () => void
  const reporter = createPushPresenceReporter((foreground) => {
    calls.push(foreground)
    return calls.length === 1
      ? new Promise<void>((resolve) => {
          complete = resolve
        })
      : Promise.resolve()
  })
  reporter.report(true)
  reporter.report(false)
  reporter.report(true)
  reporter.stop()
  reporter.report(true)
  assert.deepEqual(calls, [true])
  complete()
  await tick()
  assert.deepEqual(calls, [true, false])
})

test("相同前台状态仍定时续租，网络失败不阻塞后续后台上报", async () => {
  const calls: boolean[] = []
  const reporter = createPushPresenceReporter(async (value) => {
    calls.push(value)
    if (calls.length === 1) throw new Error("offline")
  })
  assert.equal(PUSH_PRESENCE_HEARTBEAT_MS, 15_000)
  reporter.report(true)
  await tick()
  reporter.report(true)
  await tick()
  reporter.report(false)
  await tick()
  assert.deepEqual(calls, [true, true, false])
})

test("后台不重复写心跳，但前台请求失败后仍补报后台状态", async () => {
  const calls: boolean[] = []
  const reporter = createPushPresenceReporter(async (foreground) => {
    calls.push(foreground)
    if (foreground) throw new Error("response lost after server update")
  })
  reporter.report(false)
  await tick()
  reporter.report(false)
  await tick()
  assert.deepEqual(calls, [false])
  reporter.report(true)
  await tick()
  reporter.report(false)
  await tick()
  reporter.stop()
  await tick()
  assert.deepEqual(calls, [false, true, false])
})

function source(path: string) {
  const url = new URL(path, import.meta.url)
  return ts.createSourceFile(url.pathname, readFileSync(url, "utf8"), ts.ScriptTarget.Latest, true)
}

test("Desktop只有窗口聚焦、系统活跃、未锁屏休眠时才上报活跃", () => {
  const file = source("../src/main/index.ts")
  let getter = "",
    suspend = "",
    resume = ""
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === "isDesktopActive")
      getter = node.initializer.getText(file)
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (node.name.getText(file) === "suspendPresence") suspend = node.initializer.getText(file)
      if (node.name.getText(file) === "resumePresence") resume = node.initializer.getText(file)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(getter && suspend && resume)
  let focused = true,
    idle = "active",
    idleStateUnavailable = false,
    destroyed = false,
    refreshes = 0
  const state = new Function(
    "mainWindow",
    "powerMonitor",
    "auth",
    `let desktopUnavailable = false; return { active: ${getter}, suspend: ${suspend}, resume: ${resume} };`,
  )(
    { isFocused: () => focused, isDestroyed: () => destroyed },
    {
      getSystemIdleState: (seconds: number) => {
        assert.equal(seconds, 120)
        if (idleStateUnavailable) throw new Error("native idle API unavailable")
        return idle
      },
    },
    { refreshPushPresence: () => refreshes++ },
  )
  assert.equal(state.active(), true)
  state.suspend()
  assert.equal(state.active(), false)
  state.resume()
  assert.equal(state.active(), true)
  focused = false
  assert.equal(state.active(), false)
  focused = true
  idle = "idle"
  assert.equal(state.active(), false)
  idle = "active"
  idleStateUnavailable = true
  assert.equal(state.active(), false)
  idleStateUnavailable = false
  destroyed = true
  assert.equal(state.active(), false)
  assert.equal(refreshes, 2)
})

test("Desktop未初始化或实时连接断开时不抑制手机通知", () => {
  const file = source("../src/main/account/account-runtime.ts")
  let body = ""
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === "refreshPushPresence")
      body = node.body!.getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(body)
  const run = new Function(body)
  for (const initialized of [false, true])
    for (const realtimeReady of [false, true])
      for (const active of [false, true]) {
        let result: boolean | undefined
        run.call({
          initialized,
          realtimeReady,
          input: { isDesktopActive: () => active },
          pushPresence: {
            report: (value: boolean) => {
              result = value
            },
          },
        })
        assert.equal(result, initialized && realtimeReady && active)
      }
})
