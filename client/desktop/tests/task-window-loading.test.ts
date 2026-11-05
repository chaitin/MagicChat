import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

function compile(path: string, append = "") {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8") + append, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
}
const page = compile("../src/renderer/features/projects/project-task-window-page.tsx")
const startup = compile("../src/renderer/task-window-startup.tsx")
const dialog = compile(
  "../src/renderer/features/projects/project-task-dialog.tsx",
  "\nexport { TaskPropertyFields, initialForm }\n",
)
const jsx = (type: any, props: any) => ({ type, props })
const runtime = { jsx, jsxs: jsx, Fragment: "Fragment" }

function nodes(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!node || typeof node !== "object") return []
  return [node, ...nodes(node.props?.children)]
}
function find(node: any, type: string) {
  return nodes(node).find((node) => node.type === type)
}
function textContent(node: any): string {
  if (Array.isArray(node)) return node.map(textContent).join("")
  if (node == null || typeof node === "boolean") return ""
  if (typeof node !== "object") return String(node)
  return textContent(node.props?.children)
}
function deferred<T = any>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const task = {
  id: "task",
  title: "发布任务",
  description: "",
  status: "todo",
  priority: 2,
  labels: [],
  startDate: null,
  dueDate: null,
  reminder: null,
  assignee: { id: "u1", name: "王明", nickname: "小王" },
}
const member = {
  id: "u1",
  name: "王明",
  nickname: "小王",
  displayName: "小王",
  status: "active",
  email: "",
  phone: "",
}

function fixture(
  t: test.TestContext,
  options: {
    context?: {
      targetId: string
      projectId: string
      taskId: string | null
      view?: "project"
      projectName?: string
    }
    initialization?: Promise<any>
    taskResult?: Promise<any>
  } = {},
) {
  let cursor = 0,
    dirty = false,
    mounted = true,
    root: any
  let lateUpdates = 0,
    taskCalls = 0
  const states = new Map<number, any>()
  const effects = new Map<number, { deps: any[]; cleanup?: () => void }>()
  let pending: Array<() => void> = []
  const memberRequests: Array<{ input: any; result: ReturnType<typeof deferred> }> = []
  const context = options.context ?? { targetId: "account", projectId: "project", taskId: "task" }
  const bridge = {
    initialize: () => options.initialization ?? Promise.resolve(context),
    accountData: {
      getProjectTask: () => {
        taskCalls++
        return options.taskResult ?? Promise.resolve({ ok: true, data: task })
      },
      listProjectTaskAssignees: (input: any) => {
        const result = deferred()
        memberRequests.push({ input, result })
        return result.promise
      },
    },
    windowControls: {},
    onThemeChanged: () => () => {},
    getTheme: async () => "light",
    notifyChanged: async () => {},
  }
  const react = {
    useState: (initial: any) => {
      const index = cursor++
      if (!states.has(index)) states.set(index, typeof initial === "function" ? initial() : initial)
      return [
        states.get(index),
        (next: any) => {
          if (!mounted) {
            lateUpdates++
            return
          }
          const value = typeof next === "function" ? next(states.get(index)) : next
          if (!Object.is(value, states.get(index))) {
            states.set(index, value)
            dirty = true
          }
        },
      ]
    },
    useEffect: (run: () => any, deps: any[]) => {
      const index = cursor++
      const previous = effects.get(index)
      if (
        previous &&
        deps.length === previous.deps.length &&
        deps.every((value, index) => Object.is(value, previous.deps[index]))
      )
        return
      pending.push(() => {
        previous?.cleanup?.()
        effects.set(index, { deps, cleanup: run() })
      })
    },
  }
  const module = { exports: {} as any }
  runInNewContext(page, {
    module,
    exports: module.exports,
    window: {
      taskWindow: bridge,
      matchMedia: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    },
    document: { documentElement: { classList: { toggle: () => {} }, style: {} } },
    require: (name: string) =>
      name === "react"
        ? react
        : name === "react/jsx-runtime"
          ? runtime
          : new Proxy({}, { get: (_target, key) => key }),
  })
  function render() {
    cursor = 0
    dirty = false
    pending = []
    root = module.exports.ProjectTaskWindowPage()
    for (const run of pending) run()
  }
  async function flush() {
    for (let turn = 0; turn < 20; turn++) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (!dirty || !mounted) return
      render()
    }
    assert.fail("组件状态未收敛")
  }
  function unmount() {
    if (!mounted) return
    mounted = false
    for (const effect of effects.values()) effect.cleanup?.()
  }
  t.after(unmount)
  render()
  return {
    flush,
    unmount,
    memberRequests,
    get root() {
      return root
    },
    get dialog() {
      return find(root, "ProjectTaskDialog")
    },
    get taskCalls() {
      return taskCalls
    },
    get lateUpdates() {
      return lateUpdates
    },
  }
}

test("项目模式复用任务管理组件，不加载单任务详情或重复成员目录，不显示左侧项目导航", async (t) => {
  const f = fixture(t, {
    context: {
      targetId: "account",
      projectId: "project",
      taskId: null,
      view: "project",
      projectName: "开发项目",
    },
  })
  await f.flush()
  const panel = find(f.root, "ProjectTaskPanel")
  assert.ok(panel)
  assert.equal(panel.props.targetId, "account")
  assert.equal(panel.props.projectId, "project")
  assert.equal(panel.props.projectName, "开发项目")
  assert.equal(panel.props.showOpenWindowButton, false)
  assert.equal(f.dialog, undefined)
  assert.equal(f.taskCalls, 0)
  assert.equal(f.memberRequests.length, 0)
  assert.equal(find(f.root, "WindowTitleBar").props.brandTitle, "开发项目 · 任务")
  assert.equal(find(f.root, "ProjectsPage"), undefined)
})

test("任务先展示，成员未返回也不阻塞详情，且不会误清空原负责人", async (t) => {
  const f = fixture(t)
  await f.flush()
  assert.ok(f.dialog)
  assert.equal(f.dialog.props.task, task)
  assert.equal(f.dialog.props.task.assignee.id, "u1")
  assert.equal(f.dialog.props.membersDisabled, true)
  assert.equal(f.memberRequests.length, 1)
  assert.match(textContent(f.root), /正在加载负责人列表/)
  f.memberRequests[0].result.resolve({ ok: true, data: { items: [member], nextCursor: null } })
  await f.flush()
  assert.equal(f.dialog.props.membersDisabled, false)
  assert.equal(f.dialog.props.members.length, 1)
  assert.equal(f.taskCalls, 1)
})

test("成员失败仍保留任务；只重试成员，不重载详情或重置编辑器", async (t) => {
  const f = fixture(t)
  await f.flush()
  const originalTask = f.dialog.props.task
  f.memberRequests[0].result.resolve({ ok: false, error: { message: "成员加载失败" } })
  await f.flush()
  assert.equal(f.dialog.props.task, originalTask)
  assert.equal(f.dialog.props.membersDisabled, true)
  assert.match(textContent(f.root), /负责人列表加载失败/)
  const retry = nodes(f.root).find(
    (node) => node.type === "Button" && node.props.children === "重试",
  )
  assert.ok(retry)
  retry.props.onClick()
  await f.flush()
  assert.equal(f.memberRequests.length, 2)
  assert.equal(f.taskCalls, 1)
  assert.equal(f.dialog.props.task, originalTask)
  f.memberRequests[1].result.resolve({ ok: true, data: { items: [member], nextCursor: null } })
  await f.flush()
  assert.equal(f.dialog.props.membersDisabled, false)
  assert.equal(f.taskCalls, 1)
})

test("成员分页继续加载时任务始终可见，全部完成后启用负责人", async (t) => {
  const f = fixture(t)
  await f.flush()
  f.memberRequests[0].result.resolve({ ok: true, data: { items: [member], nextCursor: "next" } })
  await f.flush()
  assert.ok(f.dialog)
  assert.equal(f.dialog.props.membersDisabled, true)
  assert.equal(f.memberRequests[1].input.cursor, "next")
  f.memberRequests[1].result.resolve({
    ok: true,
    data: { items: [{ ...member, id: "inactive", status: "inactive" }], nextCursor: null },
  })
  await f.flush()
  assert.equal(f.dialog.props.membersDisabled, false)
  assert.equal(f.dialog.props.members.length, 1)
})

test("分页异常只影响负责人，不会把任务详情变成错误页", async (t) => {
  const f = fixture(t)
  await f.flush()
  f.memberRequests[0].result.resolve({ ok: true, data: { items: [], nextCursor: "bad" } })
  await f.flush()
  assert.ok(f.dialog)
  assert.equal(f.dialog.props.membersDisabled, true)
  assert.match(textContent(f.root), /负责人列表加载失败/)
})

test("任务失败不等待成员，错误和重试入口立即出现", async (t) => {
  const f = fixture(t, {
    taskResult: Promise.resolve({ ok: false, error: { message: "任务不存在" } }),
  })
  await f.flush()
  assert.equal(f.dialog, undefined)
  assert.match(textContent(f.root), /任务不存在/)
  assert.match(textContent(f.root), /重新加载/)
  assert.equal(f.memberRequests.length, 1)
})

test("创建任务不用等成员数据，不请求不存在的详情", async (t) => {
  const f = fixture(t, { context: { targetId: "account", projectId: "project", taskId: null } })
  await f.flush()
  assert.ok(f.dialog)
  assert.equal(f.dialog.props.task, null)
  assert.equal(f.taskCalls, 0)
  assert.equal(f.dialog.props.membersDisabled, true)
})

test("卸载后晚到的初始化、详情与成员响应不再更新状态", async (t) => {
  const initialization = deferred()
  const beforeStart = fixture(t, { initialization: initialization.promise })
  beforeStart.unmount()
  initialization.resolve({ targetId: "account", projectId: "project", taskId: "task" })
  await beforeStart.flush()
  assert.equal(beforeStart.taskCalls, 0)
  assert.equal(beforeStart.lateUpdates, 0)
  const pendingTask = deferred()
  const f = fixture(t, { taskResult: pendingTask.promise })
  await f.flush()
  f.unmount()
  pendingTask.resolve({ ok: true, data: task })
  f.memberRequests[0].result.resolve({ ok: true, data: { items: [member], nextCursor: null } })
  await f.flush()
  assert.equal(f.lateUpdates, 0)
})

test("两种属性视图仅禁用负责人，保留原负责人ID和姓名，状态优先级仍可操作", () => {
  const module = { exports: {} as any }
  runInNewContext(dialog, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === "react/jsx-runtime") return runtime
      if (name === "./task-view-model")
        return {
          taskStatuses: ["todo", "in_progress", "done", "canceled"],
          taskStatusLabels: {},
          taskPriorities: [0, 1, 2, 3, 4],
          taskPriorityLabels: {},
        }
      return new Proxy({}, { get: (_target, key) => key })
    },
  })
  for (const hideEmpty of [false, true]) {
    const values = module.exports.initialForm(task)
    const root = module.exports.TaskPropertyFields({
      targetId: "account",
      members: [],
      values,
      task,
      theme: "light",
      disabled: false,
      membersDisabled: true,
      hideEmpty,
      onChange: () => {},
    })
    const picker = find(root, "TaskAssigneePicker")
    assert.equal(picker.props.disabled, true)
    assert.equal(picker.props.value, "u1")
    assert.equal(picker.props.name, "小王")
    assert.ok(
      nodes(root)
        .filter((node) => node.type === "Select")
        .every((node) => node.props.disabled === false),
    )
  }
})

test("加载外壳可关闭；模块渲染失败显示重载入口，并确认错误页已启动", async () => {
  let initialized = 0,
    reloaded = 0
  const controls = { close: async () => {} }
  class Component {
    props: any
    constructor(props: any) {
      this.props = props
    }
  }
  const module = { exports: {} as any }
  runInNewContext(startup, {
    module,
    exports: module.exports,
    window: {
      taskWindow: {
        windowControls: controls,
        initialize: async () => {
          initialized++
        },
      },
      location: {
        reload: () => {
          reloaded++
        },
      },
    },
    require: (name: string) =>
      name === "react"
        ? { Component }
        : name === "react/jsx-runtime"
          ? runtime
          : { WindowTitleBar: "WindowTitleBar" },
  })
  const loading = module.exports.TaskWindowLoading()
  const shell = loading.type(loading.props)
  assert.match(textContent(shell), /正在打开任务/)
  assert.equal(find(shell, "WindowTitleBar").props.controls, controls)
  const Boundary = module.exports.TaskWindowStartupBoundary
  const boundary = new Boundary({ children: "正常内容" })
  assert.equal(boundary.render(), "正常内容")
  boundary.state = Boundary.getDerivedStateFromError(new Error("chunk failed"))
  boundary.componentDidCatch()
  await Promise.resolve()
  assert.equal(initialized, 1)
  const failure = boundary.render()
  const errorShell = failure.type(failure.props)
  assert.match(textContent(errorShell), /任务窗口加载失败/)
  find(errorShell, "button").props.onClick()
  assert.equal(reloaded, 1)
})

test("两层异步模块加载只为任务窗口显示外壳，错误边界不改变主窗口或截图入口", () => {
  const main = readFileSync(new URL("../src/renderer/main.tsx", import.meta.url), "utf8")
  const pages = readFileSync(new URL("../src/renderer/app-pages.tsx", import.meta.url), "utf8")
  for (const source of [main, pages])
    assert.match(source, /fallback=\{taskWindowMode \? <TaskWindowLoading \/> : null\}/)
  assert.match(main, /taskWindowMode \? \(\s*<TaskWindowStartupBoundary>/)
  assert.match(main, /screenshotMode \? \(\s*<ScreenshotOverlay \/>/)
})
