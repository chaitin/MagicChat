import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import {
  describePushJob,
  getPushRegistrationDiagnostic,
  subscribePushRegistrationDiagnostic,
  updatePushRegistrationDiagnostic,
  waitForPushDevice,
} from "../src/notifications/push-diagnostics.ts"
import type { PushAccountIdentity } from "../src/notifications/push-types.ts"

const identity: PushAccountIdentity = {
  accountId: "account",
  generation: 1,
  target: { id: "server", url: "https://server.test", userId: "user" },
}

test("设备Token获取有超时并可恢复，避免永远处于开启中", async () => {
  await assert.rejects(
    waitForPushDevice(new Promise(() => {}), 1),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "push_device_token_timeout",
  )
  assert.equal(
    await waitForPushDevice(Promise.resolve("device"), 100),
    "device",
  )
})

test("注册诊断按阶段更新，只记录状态与错误类别，不记录凭据", () => {
  let updates = 0
  const unsubscribe = subscribePushRegistrationDiagnostic(() => updates++)
  updatePushRegistrationDiagnostic(identity, "device_token")
  assert.equal(getPushRegistrationDiagnostic().stage, "device_token")
  updatePushRegistrationDiagnostic(
    identity,
    "device_token",
    "failed",
    "push_device_token_timeout",
  )
  assert.equal(getPushRegistrationDiagnostic().status, "failed")
  updatePushRegistrationDiagnostic(identity, "private_server", "registered")
  assert.equal(getPushRegistrationDiagnostic().code, null)
  assert.equal(updates, 3)
  unsubscribe()
  updatePushRegistrationDiagnostic(identity, "permission")
  assert.equal(updates, 3)
  assert.deepEqual(Object.keys(getPushRegistrationDiagnostic()).sort(), [
    "accountId",
    "code",
    "generation",
    "stage",
    "status",
  ])
})

test("诊断区分策略跳过、网关接收和厂商受理，不能误称手机已送达", () => {
  assert.equal(describePushJob("suppressed", "already_read"), "已读，不再推送")
  assert.match(describePushJob("suppressed", "mobile_foreground"), /本机前台/)
  assert.match(describePushJob("suppressed", "desktop_active"), /电脑活跃/)
  assert.equal(describePushJob("sent"), "推送网关已接收")
  assert.match(describePushJob("accepted"), /不是手机送达回执/)
  assert.match(describePushJob("failed", "BadDeviceToken"), /BadDeviceToken/)
  assert.equal(describePushJob(), "暂无推送任务")
})

test("旧账号注册完成或失败不能覆盖新账号诊断，原始异常内容不会展示", async () => {
  const file = ts.createSourceFile(
    "push-lifecycle.ts",
    readFileSync(
      new URL("../src/notifications/push-lifecycle.ts", import.meta.url),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
  )
  const declarations: string[] = []
  function visit(node: ts.Node) {
    if (
      ts.isFunctionDeclaration(node) &&
      (node.name?.text === "reportRegistrationStage" ||
        node.name?.text === "synchronizePushDelegation")
    )
      declarations.push(node.getText(file).replace(/^export /, ""))
    ts.forEachChild(node, visit)
  }
  visit(file)
  const compiled = ts.transpileModule(declarations.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  let current = true,
    complete!: (value: boolean) => void
  const sync = new Function(
    "isCurrentPushIdentity",
    "updatePushRegistrationDiagnostic",
    "getPushRegistrationDiagnostic",
    "synchronizeRemotePush",
    `${compiled};return synchronizePushDelegation;`,
  )(
    () => current,
    updatePushRegistrationDiagnostic,
    getPushRegistrationDiagnostic,
    () =>
      new Promise<boolean>((resolve) => {
        complete = resolve
      }),
  )
  const pending = sync(identity)
  current = false
  const next = { ...identity, accountId: "next-account", generation: 2 }
  updatePushRegistrationDiagnostic(next, "gateway")
  complete(true)
  await pending
  assert.equal(getPushRegistrationDiagnostic().accountId, "next-account")
  assert.equal(getPushRegistrationDiagnostic().stage, "gateway")
  const failed = new Function(
    "isCurrentPushIdentity",
    "updatePushRegistrationDiagnostic",
    "getPushRegistrationDiagnostic",
    "synchronizeRemotePush",
    `${compiled};return synchronizePushDelegation;`,
  )(
    () => true,
    updatePushRegistrationDiagnostic,
    getPushRegistrationDiagnostic,
    async () => {
      throw Object.assign(new Error("must-not-display-secret-token"), {
        code: "invalid code with secret",
      })
    },
  )
  await assert.rejects(failed(identity))
  assert.equal(getPushRegistrationDiagnostic().code, "push_registration_failed")
  assert.doesNotMatch(
    JSON.stringify(getPushRegistrationDiagnostic()),
    /secret|token/,
  )
})

test("上报器重建后旧请求不能覆盖新前台状态，实例之间共享发送顺序", async () => {
  const text = readFileSync(new URL("../src/providers/push-provider.tsx", import.meta.url), "utf8")
  const file = ts.createSourceFile("push-provider.tsx", text, ts.ScriptTarget.Latest, true)
  let callback = ""
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "createPushPresenceReporter") callback = node.arguments[0].getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(callback)
  const compiled = ts.transpileModule(`const send = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  for (const initial of [false, true]) {
    const previous = {}, current = {}
    const owner = { current: previous }
    const queue = { current: Promise.resolve() }
    const calls: boolean[] = []
    let complete!: () => void
    const send = (_target: unknown, _platform: unknown, foreground: boolean) => {
      calls.push(foreground)
      return calls.length === 1 ? new Promise<void>((resolve) => { complete = resolve }) : Promise.resolve()
    }
    const factory = new Function("reporter", "presenceReporterRef", "presenceRequestQueueRef", "reportPushPresence", "identity", "platform", `${compiled}; return send`)
    const oldSend = factory(previous, owner, queue, send, identity, "ios")
    const newSend = factory(current, owner, queue, send, identity, "ios")
    const first = oldSend(initial)
    await new Promise<void>((resolve) => setImmediate(resolve))
    owner.current = current
    const latest = newSend(true)
    const stale = oldSend(false)
    assert.deepEqual(calls, [initial])
    complete()
    await Promise.all([first, latest, stale])
    assert.deepEqual(calls, [initial, true])
  }
})

test("手机前后台即时更新且15秒续租，实时状态变化复用同一串行上报器", () => {
  const text = readFileSync(
    new URL("../src/providers/push-provider.tsx", import.meta.url),
    "utf8",
  )
  assert.match(text, /setInterval\(refresh, PUSH_PRESENCE_HEARTBEAT_MS\)/)
  assert.match(
    text,
    /presenceReadyRef\.current = realtimeReady && isMessageBootstrapComplete/,
  )
  assert.match(text, /reporter\.stop\(\)/)
  assert.match(text, /\[identity, isAuthenticated, isSigningOut\]/)
  assert.match(text, /presenceReporterRef\.current\?\.report/)
})
