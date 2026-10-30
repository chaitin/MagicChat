import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import {
  hasLinuxNotificationService,
  SystemNotificationAvailability,
} from "../src/main/system-notification-availability.ts"
import { isMessageNotificationSuppressed } from "../src/main/account/message-notification-policy.ts"

const service = "org.freedesktop.Notifications"
test("Linux已有通知服务时直接允许；未运行但可通过D-Bus激活时也允许", async () => {
  const calls: string[][] = []
  assert.equal(
    await hasLinuxNotificationService(async (args) => {
      calls.push(args)
      return "(true,)\n"
    }),
    true,
  )
  assert.equal(calls.length, 1)
  assert.ok(calls[0].includes("--session"))
  assert.ok(calls[0].includes(service))
  assert.equal(
    await hasLinuxNotificationService(async (args) =>
      args.includes("org.freedesktop.DBus.NameHasOwner") ? "(false,)" : `(['${service}'],)`,
    ),
    true,
  )
})

test("WSLg无通知服务、D-Bus断连或探测超时均不调用系统通知", async () => {
  for (const output of [
    "(['org.freedesktop.DBus'],)",
    "(['org.freedesktop.Notifications.Other'],)",
  ]) {
    assert.equal(
      await hasLinuxNotificationService(async (args) =>
        args.includes("org.freedesktop.DBus.NameHasOwner") ? "(false,)" : output,
      ),
      false,
    )
  }
  for (const code of ["ETIMEDOUT", "EACCES", "ECONNREFUSED"]) {
    assert.equal(
      await hasLinuxNotificationService(async () => {
        throw Object.assign(new Error("probe failed"), { code })
      }),
      false,
    )
  }
  assert.equal(await hasLinuxNotificationService(async () => "unrecognized response"), false)
})

test("没有gdbus工具时不武断禁用原本可工作的原生通知", async () => {
  assert.equal(
    await hasLinuxNotificationService(async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" })
    }),
    true,
  )
})

test("Linux探测合并并发并缓存30秒，不可用后自动重试恢复", async () => {
  let now = 0,
    probes = 0,
    available = false
  const gate = new SystemNotificationAvailability(
    "linux",
    async () => {
      probes++
      return available
    },
    () => now,
  )
  assert.deepEqual(
    await Promise.all(Array.from({ length: 20 }, () => gate.canShow())),
    Array(20).fill(false),
  )
  assert.equal(probes, 1)
  now = 29_999
  assert.equal(await gate.canShow(), false)
  assert.equal(probes, 1)
  now = 30_000
  available = true
  assert.equal(await gate.canShow(), true)
  assert.equal(probes, 2)
})

for (const platform of ["win32", "darwin"] as const) {
  test(`${platform} 不依赖Linux工具，实际显示失败后退避再恢复`, async () => {
    let now = 0
    const gate = new SystemNotificationAvailability(
      platform,
      async () => {
        throw new Error("不得探测Linux")
      },
      () => now,
    )
    assert.equal(await gate.canShow(), true)
    gate.failed()
    assert.equal(await gate.canShow(), false)
    now = 30_000
    assert.equal(await gate.canShow(), true)
  })
}

test("已收到失败的通知不能被迟到的成功探测覆盖", async () => {
  let resolve!: (value: boolean) => void
  const gate = new SystemNotificationAvailability(
    "linux",
    () =>
      new Promise((done) => {
        resolve = done
      }),
    () => 0,
  )
  const pending = gate.canShow()
  await Promise.resolve()
  gate.failed()
  resolve(true)
  assert.equal(await pending, false)
  assert.equal(await gate.canShow(), false)
})

function notifications(canShow: () => Promise<boolean> = async () => true) {
  const source = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8")
  const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true)
  const functions: string[] = []
  function visit(node: ts.Node) {
    if (
      ts.isFunctionDeclaration(node) &&
      ["notifyIncomingMessage", "showIncomingMessageNotification"].includes(node.name?.text ?? "")
    )
      functions.push(`export ${node.getText(ast)}`)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const compiled = ts.transpileModule(functions.join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const created: FakeNotification[] = [],
    sent: unknown[][] = [],
    actions: unknown[][] = []
  let failures = 0,
    supportedChecks = 0,
    active = true
  class FakeNotification extends EventEmitter {
    readonly options: any
    constructor(options: any) {
      super()
      this.options = options
      created.push(this)
    }
    static isSupported() {
      supportedChecks++
      return true
    }
    show() {}
  }
  const settings = { soundEnabled: true, desktopEnabled: true, showMessagePreview: true }
  const context: any = {
    exports: {},
    SystemNotification: FakeNotification,
    notificationSettings: settings,
    notificationAvailability: {
      canShow,
      failed() {
        failures++
      },
    },
    activeNotifications: new Set(),
    activeConversation: null,
    mainWindow: null,
    isQuitting: false,
    auth: { isActiveTarget: () => active },
    isMessageNotificationSuppressed,
    mainWindowMessages: {
      send: (...args: unknown[]) => sent.push(args),
      sendWhenReady: (...args: unknown[]) => actions.push(args),
    },
    showMainWindow() {},
    console: { warn() {} },
    DESKTOP_CHANNELS: { playMessageSound: "sound", openMessageNotification: "open" },
  }
  runInNewContext(compiled, context)
  return {
    context,
    settings,
    created,
    sent,
    actions,
    show: context.exports.showIncomingMessageNotification as (event: any) => Promise<void>,
    incoming: context.exports.notifyIncomingMessage as (event: any) => void,
    failures: () => failures,
    supportedChecks: () => supportedChecks,
    setActive: (value: boolean) => {
      active = value
    },
  }
}
const event = {
  targetId: "account",
  conversationId: "room",
  messageId: "message",
  sender: "Alice",
  summary: "private message",
}

test("服务不可用时连Electron支持探测都不调用；关闭桌面通知仍保留提示音", async () => {
  const f = notifications(async () => false)
  await f.show(event)
  assert.equal(f.created.length, 0)
  assert.equal(f.supportedChecks(), 0)
  f.settings.desktopEnabled = false
  f.incoming(event)
  assert.deepEqual(f.sent, [["sound"]])
})

test("异步探测后重新检查账号、通知开关、退出状态及当前会话聚焦", async () => {
  for (const reason of ["account", "settings", "quit", "focused"]) {
    let resolve!: (value: boolean) => void
    const f = notifications(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const pending = f.show(event)
    if (reason === "account") f.setActive(false)
    if (reason === "settings") f.settings.desktopEnabled = false
    if (reason === "quit") f.context.isQuitting = true
    if (reason === "focused") {
      f.context.activeConversation = { targetId: "account", conversationId: "room" }
      f.context.mainWindow = { isDestroyed: () => false, isFocused: () => true }
    }
    resolve(true)
    await pending
    assert.equal(f.created.length, 0, reason)
  }
})

test("显示使用最新隐私设置，失败回收通知对象并退避；点击动作延后时再次校验账号", async () => {
  let resolve!: (value: boolean) => void
  const f = notifications(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const pending = f.show(event)
  f.settings.showMessagePreview = false
  resolve(true)
  await pending
  assert.equal(f.created[0].options.body, "收到新消息")
  f.created[0].emit("click")
  assert.equal(f.actions.length, 1)
  const valid = f.actions[0][2] as () => boolean
  assert.equal(valid(), true)
  f.setActive(false)
  assert.equal(valid(), false)
  f.created[0].emit("failed", {}, "no service")
  assert.equal(f.failures(), 1)
  assert.equal(f.context.activeNotifications.size, 0)
})
