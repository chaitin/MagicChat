import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { AuthFailure } from "../src/shared/auth.ts"
import { TASK_WINDOW_CHANNELS } from "../src/shared/task-window.ts"
import { parseTaskWindowChange, parseTaskWindowOpenInput } from "../src/main/task-window-policy.ts"

const compiled = ts.transpileModule(
  readFileSync(new URL("../src/main/task-windows.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText
const input = { targetId: "account", projectId: "project", taskId: "task" }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function fixture(
  t: test.TestContext,
  options: {
    load?: () => Promise<void>
    developmentUrl?: string
    mainUnavailable?: boolean
  } = {},
) {
  const windows: any[] = []
  const timers = new Map<number, { callback: () => void; milliseconds: number }>()
  const notices: unknown[] = []
  const messages: Array<{ contents: any; channel: string; change: any }> = []
  const mainChanges: any[] = []
  let timerId = 0
  class Contents extends EventEmitter {
    mainFrame = {}
    destroyed = false
    zooms: number[] = []
    openHandler: any
    setZoomFactor(value: number) {
      this.zooms.push(value)
    }
    setWindowOpenHandler(handler: any) {
      this.openHandler = handler
    }
    isDestroyed() {
      return this.destroyed
    }
  }
  class Window extends EventEmitter {
    webContents = new Contents()
    destroyed = false
    visible: boolean
    minimized = false
    restores = 0
    shows = 0
    focuses = 0
    loads: unknown[] = []
    options: any
    constructor(options: any) {
      super()
      this.options = options
      this.visible = options.show !== false
      windows.push(this)
    }
    removeMenu() {}
    show() {
      this.shows++
      this.visible = true
    }
    focus() {
      this.focuses++
    }
    isDestroyed() {
      return this.destroyed
    }
    isMinimized() {
      return this.minimized
    }
    isMaximized() {
      return false
    }
    restore() {
      this.restores++
      this.minimized = false
    }
    loadFile(path: string, options: any) {
      this.loads.push({ path, options })
      return optionsLoad()
    }
    loadURL(url: string) {
      this.loads.push({ url })
      return optionsLoad()
    }
    destroy() {
      this.destroyed = true
      this.webContents.destroyed = true
      this.emit("closed")
    }
  }
  function optionsLoad() {
    return options.load?.() ?? Promise.resolve()
  }
  const main = {
    webContents: new Contents(),
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
  }
  const module = { exports: {} as any }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    URL,
    process: { platform: "win32" },
    console: { warn: () => {} },
    setTimeout: (callback: () => void, milliseconds: number) => {
      const id = ++timerId
      timers.set(id, { callback, milliseconds })
      return id
    },
    clearTimeout: (id: number) => timers.delete(id),
    require: (name: string) => {
      if (name === "electron")
        return {
          BrowserWindow: Window,
          dialog: {
            showMessageBox: async (...args: unknown[]) => {
              notices.push(args)
              return { response: 0 }
            },
          },
          screen: {
            getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
          },
        }
      if (name === "../shared/auth") return { AuthFailure }
      if (name === "../shared/task-window") return { TASK_WINDOW_CHANNELS }
      if (name === "./task-window-policy") return { parseTaskWindowOpenInput }
      if (name === "./window-position")
        return {
          centerWindowWithinWorkArea: (_bounds: unknown, _area: unknown, size: object) => ({
            x: 0,
            y: 0,
            ...size,
          }),
        }
      if (name === "./renderer-messages")
        return {
          sendToRenderer: (contents: any, channel: string, change: any) =>
            messages.push({ contents, channel, change }),
        }
      return {}
    },
  })
  const manager = new module.exports.TaskWindows(
    "preload.cjs",
    "index.html",
    options.developmentUrl,
    () => (options.mainUnavailable ? null : main),
    () => 1.1,
    "icon.png",
    (change: any) => mainChanges.push(change),
  )
  t.after(() => manager.closeAll())
  function initialize(window = windows.at(-1)) {
    return manager.initialize(window.webContents)
  }
  function expire() {
    for (const [id, timer] of [...timers]) {
      assert.equal(timer.milliseconds, 20_000)
      timers.delete(id)
      timer.callback()
    }
  }
  return { manager, windows, timers, notices, initialize, expire, main, messages, mainChanges }
}

test("项目窗口立即显示并复用，主窗口切换项目不改变已有窗口上下文", async (t) => {
  const f = fixture(t)
  const requested = {
    targetId: "account",
    projectId: "project",
    view: "project",
    projectName: "开发项目",
  }
  const first = f.manager.open(requested)
  const second = f.manager.open({ ...requested })
  assert.equal(f.windows.length, 1)
  assert.equal(f.windows[0].visible, true)
  assert.equal(f.windows[0].options.width, 1280)
  assert.match(f.windows[0].options.title, /开发项目/)
  requested.projectId = "changed-in-main"
  f.initialize()
  await Promise.all([first, second])
  assert.equal(f.manager.getContext(f.windows[0].webContents).projectId, "project")
  assert.equal(f.manager.getContext(f.windows[0].webContents).view, "project")
  f.windows[0].minimized = true
  await f.manager.open({ ...requested, projectId: "project" })
  assert.equal(f.windows[0].restores, 1)
})

test("项目窗口按账号和项目区分，不与创建任务或详情窗口混用", async (t) => {
  const f = fixture(t)
  const values = [
    { targetId: "account", projectId: "project", view: "project" },
    { targetId: "account", projectId: "other", view: "project" },
    { targetId: "other", projectId: "project", view: "project" },
    { targetId: "account", projectId: "project" },
    input,
  ]
  const openings = values.map((value) => f.manager.open(value))
  assert.equal(f.windows.length, 5)
  f.windows.forEach((window) => f.initialize(window))
  await Promise.all(openings)
})

test("任务变更双向通知同项目窗口，不广播到其他项目或账号，也不回发来源窗口", async (t) => {
  const f = fixture(t)
  const opening = [
    f.manager.open({ targetId: "account", projectId: "project", view: "project" }),
    f.manager.open({ targetId: "account", projectId: "other", view: "project" }),
    f.manager.open({ targetId: "other", projectId: "project", view: "project" }),
    f.manager.open(input),
  ]
  f.windows.forEach((window) => f.initialize(window))
  await Promise.all(opening)
  f.manager.notifyChanged(f.windows[3].webContents)
  assert.equal(f.mainChanges.length, 1)
  assert.equal(f.messages.length, 1)
  assert.equal(f.messages[0].contents, f.windows[0].webContents)
  f.manager.notifyProjectChanged({ targetId: "account", projectId: "project" }, f.main.webContents)
  assert.equal(f.mainChanges.length, 1)
  assert.equal(f.messages.length, 3)
  assert.equal(f.messages[1].contents, f.windows[0].webContents)
  assert.equal(f.messages[2].contents, f.windows[3].webContents)
})

test("变更IPC校验主frame及来源，拒绝任务窗口伪造其他项目刷新", async (t) => {
  const source = ts.createSourceFile(
    "main.ts",
    readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  )
  let handler: ts.Node | undefined
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "ipcMain.handle" &&
      node.arguments[0]?.getText(source) === "TASK_WINDOW_CHANNELS.notifyChanged"
    )
      handler = node.arguments[1]
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(handler)
  const code = ts.transpileModule("const handler = " + handler.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const f = fixture(t)
  const opening = f.manager.open({ targetId: "account", projectId: "project", view: "project" })
  f.initialize()
  await opening
  const invoke = new Function(
    "taskWindows",
    "AuthFailure",
    "parseTaskWindowChange",
    "assertTrustedSender",
    code + "\nreturn handler;",
  )(f.manager, AuthFailure, parseTaskWindowChange, (event: any) => {
    if (event.sender !== f.main.webContents) throw new AuthFailure("untrusted_sender", "不受信任")
  })
  const sender = f.windows[0].webContents
  const event = { sender, senderFrame: sender.mainFrame }
  assert.throws(() =>
    invoke({ ...event, senderFrame: {} }, { targetId: "account", projectId: "project" }),
  )
  assert.throws(() => invoke(event, { targetId: "account", projectId: "other" }))
  assert.throws(() => invoke(event, { targetId: "other", projectId: "project" }))
  assert.equal(f.mainChanges.length, 0)
  invoke(event, { targetId: "account", projectId: "project" })
  assert.equal(f.mainChanges.length, 1)
  const mainEvent = { sender: f.main.webContents, senderFrame: f.main.webContents.mainFrame }
  invoke(mainEvent, { targetId: "account", projectId: "project" })
  assert.equal(f.messages.length, 1)
  const unknown = { mainFrame: {} }
  assert.throws(() =>
    invoke(
      { sender: unknown, senderFrame: unknown.mainFrame },
      { targetId: "account", projectId: "project" },
    ),
  )
})

test("窗口立即可见，不等待ready-to-show；只在React确认启动后完成打开", async (t) => {
  const navigation = deferred<void>()
  const f = fixture(t, { load: () => navigation.promise })
  let finished = false
  const opening = f.manager.open(input).then(() => {
    finished = true
  })
  const window = f.windows[0]
  assert.equal(window.visible, true)
  assert.equal(window.listenerCount("ready-to-show"), 0)
  assert.equal(f.timers.size, 1)
  window.webContents.emit("did-finish-load")
  await Promise.resolve()
  assert.equal(finished, false)
  assert.equal(f.manager.getContext(window.webContents).taskId, input.taskId)
  assert.equal(f.timers.size, 1)
  f.initialize()
  await opening
  assert.equal(f.timers.size, 0)
  assert.equal(window.destroyed, false)
})

test("导航成功但React未启动时超时退出并反馈错误，之后可重新打开", async (t) => {
  const f = fixture(t)
  const opening = f.manager.open(input)
  const rejected = assert.rejects(opening, /任务窗口启动超时/)
  f.expire()
  await rejected
  assert.equal(f.windows[0].destroyed, true)
  assert.equal(f.manager.ownsSender(f.windows[0].webContents), false)
  const retry = f.manager.open(input)
  assert.equal(f.windows.length, 2)
  f.initialize()
  await retry
  assert.equal(f.timers.size, 0)
})

test("同一任务打开中与打开后都复用窗口，最小化时恢复并聚焦", async (t) => {
  const f = fixture(t)
  const first = f.manager.open(input)
  const second = f.manager.open({ ...input })
  assert.equal(f.windows.length, 1)
  assert.equal(f.windows[0].loads.length, 1)
  assert.equal(f.windows[0].focuses, 1)
  f.initialize()
  await Promise.all([first, second])
  f.windows[0].minimized = true
  await f.manager.open(input)
  assert.equal(f.windows.length, 1)
  assert.equal(f.windows[0].restores, 1)
  assert.equal(f.windows[0].focuses, 2)
})

test("任务、项目、账号不同不复用，创建任务窗口仍可分别保留草稿", async (t) => {
  const f = fixture(t)
  const inputs = [
    input,
    { ...input, targetId: "other-account" },
    { ...input, projectId: "other-project" },
    { ...input, taskId: "other-task" },
    { targetId: input.targetId, projectId: input.projectId },
    { targetId: input.targetId, projectId: input.projectId },
  ]
  const opening = inputs.map((value) => f.manager.open(value))
  assert.equal(f.windows.length, inputs.length)
  f.windows.forEach((window) => f.initialize(window))
  await Promise.all(opening)
})

for (const failure of ["navigation", "main-frame", "preload", "renderer"] as const) {
  test("启动期间失败会清理窗口并拒绝打开请求：" + failure, async (t) => {
    const navigation = deferred<void>()
    const f = fixture(t, { load: () => navigation.promise })
    const opening = f.manager.open(input)
    const rejected = assert.rejects(opening, /任务窗口.*(失败|异常)/)
    const window = f.windows[0]
    if (failure === "navigation") navigation.reject(new Error("navigation failed"))
    if (failure === "main-frame")
      window.webContents.emit("did-fail-load", {}, -105, "failed", "", true)
    if (failure === "preload")
      window.webContents.emit("preload-error", {}, "preload.cjs", new Error("failed"))
    if (failure === "renderer")
      window.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 })
    await rejected
    assert.equal(window.destroyed, true)
    assert.equal(f.timers.size, 0)
    assert.equal(f.notices.length, 0)
    assert.equal(f.manager.ownsSender(window.webContents), false)
  })
}

test("子资源失败与取消导航不误杀窗口", async (t) => {
  const f = fixture(t)
  const opening = f.manager.open(input)
  const window = f.windows[0]
  window.webContents.emit("did-fail-load", {}, -105, "subresource", "", false)
  window.webContents.emit("did-fail-load", {}, -3, "aborted", "", true)
  assert.equal(window.destroyed, false)
  f.initialize()
  await opening
})

test("启动后渲染进程退出也会清理窗口并显示错误，不再留空白窗口", async (t) => {
  const f = fixture(t)
  const opening = f.manager.open(input)
  f.initialize()
  await opening
  const window = f.windows[0]
  window.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 })
  assert.equal(window.destroyed, true)
  assert.equal(f.notices.length, 1)
  assert.equal(f.timers.size, 0)
})

test("启动中主动关闭以及退出登录会完成等待并清理计时器，晚到错误不影响新窗口", async (t) => {
  const navigation = deferred<void>()
  let loads = 0
  const f = fixture(t, { load: () => (++loads === 1 ? navigation.promise : Promise.resolve()) })
  const opening = f.manager.open(input)
  f.windows[0].destroy()
  await opening
  assert.equal(f.timers.size, 0)
  const retry = f.manager.open(input)
  f.initialize()
  await retry
  navigation.reject(new Error("late navigation failure"))
  await Promise.resolve()
  assert.equal(f.windows[1].destroyed, false)
  const another = f.manager.open({ ...input, taskId: "another" })
  f.manager.closeAll()
  await another
  assert.equal(f.timers.size, 0)
  assert.equal(f.notices.length, 0)
})

test("不可信开发地址和主窗口不可用时不创建窗口", async (t) => {
  const untrusted = fixture(t, { developmentUrl: "https://untrusted.invalid" })
  await assert.rejects(untrusted.manager.open(input), /不受信任/)
  assert.equal(untrusted.windows.length, 0)
  const unavailable = fixture(t, { mainUnavailable: true })
  await assert.rejects(unavailable.manager.open(input), /主窗口不可用/)
  assert.equal(unavailable.windows.length, 0)
})

test("开发地址使用正确任务路由，安全配置与sender校验保持不变", async (t) => {
  const f = fixture(t, { developmentUrl: "http://127.0.0.1:20110/" })
  const opening = f.manager.open(input)
  const window = f.windows[0]
  assert.equal(window.loads[0].url, "http://127.0.0.1:20110/#/task-window")
  assert.equal(window.options.webPreferences.contextIsolation, true)
  assert.equal(window.options.webPreferences.sandbox, true)
  assert.equal(window.options.webPreferences.nodeIntegration, false)
  assert.equal(window.options.webPreferences.webSecurity, true)
  assert.equal(window.webContents.openHandler().action, "deny")
  assert.throws(() => f.manager.initialize({}), /不受信任/)
  assert.equal(f.timers.size, 1)
  f.initialize()
  await opening
})

test("同步导航异常也会拒绝请求并回收窗口", async (t) => {
  const f = fixture(t, {
    load: () => {
      throw new Error("invalid file")
    },
  })
  await assert.rejects(f.manager.open(input), /任务窗口页面加载失败/)
  assert.equal(f.windows[0].destroyed, true)
  assert.equal(f.timers.size, 0)
})
