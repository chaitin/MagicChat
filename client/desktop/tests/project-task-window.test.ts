import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { ACCOUNT_DATA_CHANNELS } from "../src/shared/account-data.ts"
import { TASK_WINDOW_CHANNELS } from "../src/shared/task-window.ts"
import {
  assertTaskWindowAccountRequest,
  parseTaskWindowChange,
  parseTaskWindowOpenInput,
} from "../src/main/task-window-policy.ts"

function compile(path: string) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
}
const compiled = compile("../src/renderer/features/projects/project-task-panel.tsx")
const wrapper = compile("../src/renderer/features/projects/project-tasks-page.tsx")
const jsx = (type: any, props: any) => ({ type, props })
const runtime = { jsx, jsxs: jsx }
const scope = { targetId: "account", projectId: "project" }
const task = {
  id: "task",
  title: "发布任务",
  status: "todo",
  priority: 2,
  assignee: { id: "u1" },
  labels: [],
}
const plain = (value: any) => JSON.parse(JSON.stringify(value))

function nodes(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!node || typeof node !== "object") return []
  return [node, ...nodes(node.props?.children)]
}
function textContent(node: any): string {
  if (Array.isArray(node)) return node.map(textContent).join("")
  if (!node || typeof node === "boolean") return ""
  return typeof node === "object" ? textContent(node.props?.children) : String(node)
}

function panel(
  options: {
    showOpenWindowButton?: boolean
    tasks?: any[]
    saveFailed?: boolean
    openFailed?: boolean
    notifyFailed?: boolean
  } = {},
) {
  const opens: any[] = [],
    changes: any[] = [],
    updates: any[] = [],
    resolves: any[] = [],
    toasts: any[] = []
  const effects: Array<() => any> = []
  const states = new Map<number, any>()
  let index = 0,
    listener: any,
    unsubscribed = false
  const module = { exports: {} as any }
  const props = {
    ...scope,
    projectName: "开发项目",
    resolvedTheme: "light",
    showOpenWindowButton: options.showOpenWindowButton,
  }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    window: {
      localStorage: { getItem: () => "list" },
      desktop: {
        taskWindows: {
          open: async (input: any) => {
            opens.push(input)
            return options.openFailed
              ? { ok: false, error: { message: "启动超时" } }
              : { ok: true, data: null }
          },
          notifyChanged: async (input: any) => {
            changes.push(input)
            if (options.notifyFailed) throw new Error("notify failed")
          },
          onChanged: (callback: any) => {
            listener = callback
            return () => {
              unsubscribed = true
            }
          },
        },
        accountData: {
          resolveUserNames: async (input: any) => {
            resolves.push(input)
            return { ok: true, data: [] }
          },
          updateProjectTask: async (input: any) => {
            updates.push(input)
            return options.saveFailed
              ? { ok: false, error: { message: "更新失败" } }
              : { ok: true, data: task }
          },
        },
      },
    },
    require: (name: string) => {
      if (name === "react")
        return {
          useState: (initial: any) => {
            const id = index++
            const value =
              id === 3
                ? (options.tasks ?? [task])
                : id === 4
                  ? false
                  : typeof initial === "function"
                    ? initial()
                    : initial
            states.set(id, value)
            return [
              value,
              (next: any) =>
                states.set(id, typeof next === "function" ? next(states.get(id)) : next),
            ]
          },
          useRef: (value: any) => ({ current: value }),
          useEffect: (callback: () => any) => effects.push(callback),
          startTransition: (callback: () => void) => callback(),
        }
      if (name === "react/jsx-runtime") return runtime
      if (name.endsWith("animated-toast-provider"))
        return { useAnimatedToast: () => ({ showToast: (value: any) => toasts.push(value) }) }
      if (name === "@/lib/utils")
        return { cn: (...values: any[]) => values.filter(Boolean).join(" ") }
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
  const root = module.exports.ProjectTaskPanel(props)
  return {
    root,
    props,
    opens,
    changes,
    updates,
    toasts,
    states,
    component: module.exports.ProjectTaskPanel,
    list: nodes(root).find((node) => node.type === "TaskListView"),
    openButton: nodes(root).find((node) => node.props?.["aria-label"] === "在新窗口中打开项目任务"),
    resolves,
    resolveNames: () => effects[3](),
    subscribe: () => effects.at(-1)!(),
    publish: (change: any) => listener(change),
    get unsubscribed() {
      return unsubscribed
    },
    flush: () => new Promise<void>((resolve) => setImmediate(resolve)),
  }
}

test("任务超过100位负责人时分批解析，遵守独立窗口IPC限制且不遗漏用户", async () => {
  const f = panel({
    tasks: Array.from({ length: 205 }, (_, index) => ({
      ...task,
      id: "t" + index,
      assignee: { id: "u" + index },
    })),
  })
  f.resolveNames()
  await f.flush()
  assert.deepEqual(
    f.resolves.map((request) => request.userIds.length),
    [100, 100, 5],
  )
  assert.equal(new Set(f.resolves.flatMap((request) => request.userIds)).size, 205)
  const context = parseTaskWindowOpenInput({ ...scope, view: "project" })
  for (const request of f.resolves)
    assert.doesNotThrow(() =>
      assertTaskWindowAccountRequest(context, ACCOUNT_DATA_CHANNELS.resolveUserNames, request),
    )
})

test("开窗按钮紧跟创建任务，只有图标且携带当前项目及名称", async () => {
  const f = panel()
  const buttons = nodes(f.root).filter((node) => node.type === "Button")
  const create = buttons.find((node) => textContent(node) === "创建任务")
  assert.ok(create)
  assert.ok(f.openButton)
  assert.equal(buttons.indexOf(f.openButton), buttons.indexOf(create) + 1)
  assert.equal(textContent(f.openButton), "")
  assert.equal(f.openButton.props.children.type, "ExternalLink")
  assert.equal(f.openButton.props.size, "icon-sm")
  f.openButton.props.onClick()
  await f.flush()
  assert.deepEqual(plain(f.opens), [{ ...scope, view: "project", projectName: "开发项目" }])
})

test("原页面复用共享组件；独立窗口可以隐藏再次开窗按钮，保留创建任务", () => {
  const f = panel({ showOpenWindowButton: false })
  assert.equal(f.openButton, undefined)
  assert.ok(
    nodes(f.root).find((node) => node.type === "Button" && textContent(node) === "创建任务"),
  )
  const module = { exports: {} as any }
  runInNewContext(wrapper, {
    module,
    exports: module.exports,
    require: (name: string) =>
      name === "react/jsx-runtime" ? runtime : { ProjectTaskPanel: f.component },
  })
  const embedded = module.exports.ProjectTasksPage(f.props)
  assert.equal(embedded.type, f.component)
  assert.equal(embedded.props.projectId, scope.projectId)
})

test("项目窗口与单任务详情、创建任务使用不同上下文", async () => {
  const f = panel()
  f.list.props.onOpen(task)
  const create = nodes(f.root).find(
    (node) => node.type === "Button" && textContent(node) === "创建任务",
  )
  create.props.onClick()
  await f.flush()
  assert.deepEqual(plain(f.opens), [{ ...scope, taskId: task.id }, scope])
})

for (const operation of ["status", "priority"] as const) {
  test("任务" + operation + "成功后通知其他窗口，失败时不发送刷新事件", async () => {
    for (const saveFailed of [false, true]) {
      const f = panel({ saveFailed })
      if (operation === "status") f.list.props.onMove(task, "done")
      else f.list.props.onPriorityChange(task, 1)
      await f.flush()
      assert.equal(f.updates.length, 1)
      assert.equal(f.updates[0].projectId, scope.projectId)
      assert.equal(f.changes.length, saveFailed ? 0 : 1)
      if (!saveFailed) assert.deepEqual(plain(f.changes[0]), scope)
    }
  })
}

test("通知失败不会回滚已经保存的任务", async () => {
  const f = panel({ notifyFailed: true })
  f.list.props.onMove(task, "done")
  await f.flush()
  assert.equal(f.states.get(3)[0].status, "done")
  assert.equal(f.toasts[0].status, "warning")
})

test("只响应当前账号与项目的任务变更，保留筛选与视图并可取消监听", () => {
  const f = panel()
  const filters = f.states.get(1),
    view = f.states.get(0)
  const unsubscribe = f.subscribe()
  f.publish({ ...scope, projectId: "other" })
  f.publish({ ...scope, targetId: "other" })
  assert.equal(f.states.get(6), 0)
  f.publish(scope)
  assert.equal(f.states.get(6), 1)
  assert.equal(f.states.get(1), filters)
  assert.equal(f.states.get(0), view)
  unsubscribe()
  assert.equal(f.unsubscribed, true)
})

test("开窗失败显示明确错误，不影响原任务区域", async () => {
  const f = panel({ openFailed: true })
  f.openButton.props.onClick()
  await f.flush()
  assert.equal(f.toasts[0].title, "启动超时")
  assert.ok(f.list)
})

test("项目窗口参数与变更事件进行边界校验，不能混用单任务上下文", () => {
  const context = parseTaskWindowOpenInput({ ...scope, view: "project", projectName: " 开发项目 " })
  assert.deepEqual(context, { ...scope, view: "project", projectName: "开发项目", taskId: null })
  for (const invalid of [
    { ...scope, view: "other" },
    { ...scope, view: "project", taskId: "task" },
    { ...scope, view: "project", projectName: 123 },
    { ...scope, view: "project", projectName: "x".repeat(257) },
    { ...scope, projectId: "" },
  ])
    assert.throws(() => parseTaskWindowOpenInput(invalid))
  assert.deepEqual(parseTaskWindowChange({ ...scope, taskId: "ignored" }), scope)
  for (const invalid of [
    undefined,
    null,
    { targetId: "", projectId: "project" },
    { ...scope, projectId: 123 },
  ])
    assert.throws(() => parseTaskWindowChange(invalid))
})

test("项目窗口允许本项目列表、成员、修改和打开详情，但拒绝跨账号/项目及其他项目窗口", () => {
  const context = parseTaskWindowOpenInput({ ...scope, view: "project" })
  const requests = [
    [ACCOUNT_DATA_CHANNELS.listProjectTasks, { ...scope, statuses: ["todo"] }],
    [ACCOUNT_DATA_CHANNELS.listProjectTaskAssignees, scope],
    [ACCOUNT_DATA_CHANNELS.updateProjectTask, { ...scope, taskId: "another-task", priority: 1 }],
    [TASK_WINDOW_CHANNELS.open, { ...scope, taskId: "another-task" }],
    [TASK_WINDOW_CHANNELS.open, scope],
  ] as const
  for (const [channel, input] of requests) {
    assert.doesNotThrow(() => assertTaskWindowAccountRequest(context, channel, input))
    for (const foreign of [
      { ...input, targetId: "other" },
      { ...input, projectId: "other" },
    ])
      assert.throws(() => assertTaskWindowAccountRequest(context, channel, foreign))
  }
  assert.throws(() =>
    assertTaskWindowAccountRequest(context, TASK_WINDOW_CHANNELS.open, {
      ...scope,
      view: "project",
    }),
  )
  for (const context of [
    parseTaskWindowOpenInput(scope),
    parseTaskWindowOpenInput({ ...scope, taskId: "task" }),
  ]) {
    assert.throws(() =>
      assertTaskWindowAccountRequest(context, ACCOUNT_DATA_CHANNELS.listProjectTasks, scope),
    )
    assert.throws(() =>
      assertTaskWindowAccountRequest(context, TASK_WINDOW_CHANNELS.open, {
        ...scope,
        taskId: "other",
      }),
    )
  }
})
