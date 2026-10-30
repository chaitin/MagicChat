import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import type { BrowserWindow } from "electron"
import ts from "typescript"
import { MainWindowMessages, sendToRenderer } from "../src/main/renderer-messages.ts"

function fixture() {
  const sent: unknown[][] = []
  const frame = {
    detached: false,
    destroyed: false,
    isDestroyed() {
      return this.destroyed
    },
    send: (...args: unknown[]) => {
      sent.push(args)
    },
  }
  const contents = {
    destroyed: false,
    loading: false,
    isDestroyed() {
      return this.destroyed
    },
    isLoadingMainFrame() {
      return this.loading
    },
    mainFrame: frame,
  }
  const window = {
    destroyed: false,
    isDestroyed() {
      return this.destroyed
    },
    webContents: contents,
  }
  const messages = new MainWindowMessages(() => window as unknown as BrowserWindow)
  return { sent, frame, contents, window, messages }
}

test("主窗口事件只发送给已订阅的存活主帧，暂停后必须重新订阅", () => {
  const f = fixture()
  assert.equal(f.messages.send("changed", 1), false)
  f.messages.setReady("changed", true)
  assert.equal(f.messages.send("changed", 2), true)
  assert.equal(f.messages.send("progress", 3), false)
  f.messages.pause()
  assert.equal(f.messages.send("changed", 4), false)
  f.messages.setReady("changed", true)
  assert.equal(f.messages.send("changed", 5), true)
  f.messages.setReady("changed", false)
  assert.equal(f.messages.send("changed", 6), false)
  assert.deepEqual(f.sent, [
    ["changed", 2],
    ["changed", 5],
  ])
})

for (const state of ["window", "contents", "frame", "detached"] as const) {
  test(`${state} 不可用时不访问失效发送路径`, () => {
    const f = fixture()
    f.messages.setReady("changed", true)
    if (state === "window") f.window.destroyed = true
    if (state === "contents") f.contents.destroyed = true
    if (state === "frame") f.frame.destroyed = true
    if (state === "detached") f.frame.detached = true
    assert.equal(f.messages.send("changed", {}), false)
    assert.deepEqual(f.sent, [])
  })
}

test("新页面已订阅但尚未停止加载时，初始快照之后的变更不能被丢弃", () => {
  const f = fixture()
  f.contents.loading = true
  assert.equal(f.messages.send("changed", 1), false)
  f.messages.setReady("changed", true)
  assert.equal(f.messages.send("changed", 2), true)
  assert.deepEqual(f.sent, [["changed", 2]])
})

test("窗口不存在不发送；检查后主帧销毁的竞态安全返回，但不吞掉序列化等其他错误", () => {
  assert.equal(new MainWindowMessages(() => null).send("changed"), false)
  const f = fixture()
  for (const message of [
    "Render frame was disposed before WebFrameMain could be accessed",
    "Object has been destroyed",
    "WebFrameMain has been destroyed",
  ]) {
    f.frame.send = () => {
      throw new Error(message)
    }
    assert.equal(sendToRenderer(f.contents as any, "changed"), false)
    Object.defineProperty(f.contents, "mainFrame", {
      configurable: true,
      get() {
        throw new Error(message)
      },
    })
    assert.equal(sendToRenderer(f.contents as any, "changed"), false)
    Object.defineProperty(f.contents, "mainFrame", { configurable: true, value: f.frame })
  }
  f.frame.send = () => {
    throw new Error("An object could not be cloned")
  }
  assert.throws(() => sendToRenderer(f.contents as any, "changed"), /could not be cloned/)
})

test("刷新期间延后用户动作，按频道保留最新请求；加载完成且监听注册后仅投递一次", () => {
  const f = fixture()
  f.contents.loading = true
  f.messages.sendWhenReady("settings")
  f.messages.sendWhenReady("notification", [{ messageId: "old" }])
  f.messages.sendWhenReady("notification", [{ messageId: "latest" }])
  f.messages.setReady("notification", true)
  assert.deepEqual(f.sent, [])
  f.contents.loading = false
  f.messages.flush()
  assert.deepEqual(f.sent, [["notification", { messageId: "latest" }]])
  f.messages.setReady("settings", true)
  f.messages.flush()
  assert.deepEqual(f.sent, [["notification", { messageId: "latest" }], ["settings"]])
})

test("切换账号后丢弃旧账号的延后通知，不重放加载期间的提示音或数据库变更", () => {
  const f = fixture()
  let active = true
  f.messages.sendWhenReady("notification", [{ targetId: "old" }], () => active)
  assert.equal(f.messages.send("sound"), false)
  assert.equal(f.messages.send("changed", { revision: 1 }), false)
  active = false
  for (const channel of ["notification", "sound", "changed"]) f.messages.setReady(channel, true)
  assert.deepEqual(f.sent, [])
})

test("preload先注册监听再确认就绪；多个订阅只在最后一个注销时撤销就绪", () => {
  const source = readFileSync(new URL("../src/preload/index.ts", import.meta.url), "utf8")
  const ast = ts.createSourceFile("preload.ts", source, ts.ScriptTarget.Latest, true)
  const fn = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "subscribe",
  )!
  const compiled = ts.transpileModule(`export ${fn.getText(ast)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const acks: unknown[][] = []
  const emitter = new EventEmitter() as EventEmitter & { send: (...args: unknown[]) => void }
  emitter.send = (...args) => {
    acks.push([...args, emitter.listenerCount("changed")])
  }
  const exports: any = {}
  runInNewContext(compiled, {
    exports,
    ipcRenderer: emitter,
    DESKTOP_CHANNELS: { rendererReady: "ready" },
  })
  const received: unknown[] = []
  const first = exports.subscribe("changed", (value: unknown) => received.push(value))
  const second = exports.subscribe("changed", (value: unknown) => received.push(value))
  assert.deepEqual(acks, [
    ["ready", "changed", true, 1],
    ["ready", "changed", true, 2],
  ])
  emitter.emit("changed", {}, "payload")
  assert.deepEqual(received, ["payload", "payload"])
  first()
  assert.equal(acks.length, 2)
  second()
  assert.deepEqual(acks[2], ["ready", "changed", false, 0])
})

test("主窗口生命周期接入保护，后台数据订阅仍先于初始快照读取，防止刷新遗漏数据", () => {
  const main = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8")
  assert.match(main, /details\.isMainFrame && !details\.isSameDocument/)
  assert.match(main, /"render-process-gone"/)
  assert.match(main, /mainWindowMessages\.flush\(\)/)
  assert.match(main, /on\("did-stop-loading", \(\) => mainWindowMessages\.flush\(\)\)/)
  assert.doesNotMatch(main, /webContents\.send\(/)
  assert.match(main, /rendererEventChannels\.has\(channel\)/)
  assert.match(
    main,
    /assertTrustedSender\(event\)[\s\S]*?mainWindowMessages\.setReady\(channel, ready\)/,
  )
  const data = readFileSync(
    new URL("../src/renderer/features/chat/hooks/use-chat-data.ts", import.meta.url),
    "utf8",
  )
  assert.ok(data.indexOf("accountData.onChanged") < data.indexOf("accountData.listConversations"))
})
