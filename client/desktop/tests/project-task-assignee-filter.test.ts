import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import type { ListProjectTasksInput, ProjectTaskAssignee } from "../src/shared/account-data.ts"

const path = new URL("../src/renderer/features/projects/project-tasks-page.tsx", import.meta.url)
const source = ts.createSourceFile(
  path.pathname,
  readFileSync(path, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)

function pageFunction(name: string, scope: Record<string, unknown> = {}): Function {
  let declaration: ts.FunctionDeclaration | undefined
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(declaration, `未找到页面函数 ${name}`)
  const compiled = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  const context = {
    taskPageLoads: new Map(),
    ...(name === "loadAllTasks" ? { taskCacheKey: pageFunction("taskCacheKey") } : {}),
    ...scope,
  }
  return new Function(...Object.keys(context), `${compiled}\nreturn ${name};`)(
    ...Object.values(context),
  )
}

const input: ListProjectTasksInput = {
  targetId: "account",
  projectId: "project",
  keyword: "发布",
  statuses: ["todo"],
  priorities: [2],
  assigneeUserIds: ["u1"],
  labels: ["Backend", "Frontend"],
}

test("不同负责人使用不同任务缓存，顺序不影响缓存键", () => {
  const key = pageFunction("taskCacheKey")
  assert.notEqual(key(input), key({ ...input, assigneeUserIds: ["u2"] }))
  assert.notEqual(key(input), key({ ...input, assigneeUserIds: [] }))
  const ids = ["u2", "u1"]
  assert.equal(
    key({ ...input, assigneeUserIds: ids }),
    key({ ...input, assigneeUserIds: ["u1", "u2"] }),
  )
  assert.deepEqual(ids, ["u2", "u1"])
})

test("仅筛选负责人时空结果仍显示没有匹配的任务", () => {
  const hasFilters = pageFunction("hasFilters")
  assert.equal(
    hasFilters({ keyword: "", statuses: [], priorities: [], assigneeUserIds: ["u1"], labels: [] }),
    true,
  )
  assert.equal(
    hasFilters({ keyword: "", statuses: [], priorities: [], assigneeUserIds: [], labels: [] }),
    false,
  )
})

test("选择或清空负责人立即应用，与关键词、状态和优先级组合", () => {
  for (const ids of [["u2"], []]) {
    const filters = {
      keyword: " 发布 ",
      statuses: ["todo"],
      priorities: [2],
      assigneeUserIds: ["u1"],
      labels: ["Backend"],
    }
    let next: unknown, applied: unknown
    const change = pageFunction("changeFilter", {
      filters,
      setFilters: (value: unknown) => {
        next = value
      },
      setAppliedFilters: (value: unknown) => {
        applied = value
      },
    })
    change("assigneeUserIds", ids)
    assert.deepEqual(next, { ...filters, assigneeUserIds: ids })
    assert.deepEqual(applied, { ...filters, keyword: "发布", assigneeUserIds: ids })
    assert.deepEqual(filters.assigneeUserIds, ["u1"])
  }
})

test("负责人候选来自详情同一接口，加载全部分页且过滤非活跃成员", async () => {
  const calls: unknown[] = []
  const load = pageFunction("loadAllAssignees", {
    window: {
      desktop: {
        accountData: {
          listProjectTaskAssignees: async (request: { cursor?: string }) => {
            calls.push(request)
            return {
              ok: true,
              data: {
                items: request.cursor
                  ? [
                      { id: "u101", status: "active" },
                      { id: "disabled", status: "disabled" },
                    ]
                  : Array.from({ length: 100 }, (_, index) => ({
                      id: `u${index + 1}`,
                      status: "active",
                    })),
                nextCursor: request.cursor ? null : "page2",
              },
            }
          },
        },
      },
    },
  })
  const members: ProjectTaskAssignee[] = await load("account", "project")
  assert.equal(members.length, 101)
  assert.equal(members.at(-1)?.id, "u101")
  assert.deepEqual(calls, [
    { targetId: "account", projectId: "project", limit: 100 },
    { targetId: "account", projectId: "project", limit: 100, cursor: "page2" },
  ])
})

test("负责人分页失败和重复游标会报错，不会无限请求", async () => {
  for (const fail of [true, false]) {
    let calls = 0
    const load = pageFunction("loadAllAssignees", {
      window: {
        desktop: {
          accountData: {
            listProjectTaskAssignees: async () => {
              calls++
              return fail
                ? { ok: false, error: { message: "加载成员失败" } }
                : {
                    ok: true,
                    data: { items: [{ id: "u1", status: "active" }], nextCursor: "repeat" },
                  }
            },
          },
        },
      },
    })
    await assert.rejects(load("account", "project"), {
      message: fail ? "加载成员失败" : "项目成员分页格式不正确",
    })
    assert.equal(calls, fail ? 1 : 2)
  }
})

test("任务所有分页保留负责人、关键词和其他筛选", async () => {
  const calls: unknown[] = []
  const load = pageFunction("loadAllTasks", {
    window: {
      desktop: {
        accountData: {
          listProjectTasks: async (request: { cursor?: string }) => {
            calls.push(request)
            return {
              ok: true,
              data: {
                items: [{ id: request.cursor ? "t2" : "t1" }],
                nextCursor: request.cursor ? null : "page2",
              },
            }
          },
        },
      },
    },
  })
  const pages: unknown[] = []
  assert.deepEqual(await load(input, (items: unknown) => pages.push(items)), [
    { id: "t1" },
    { id: "t2" },
  ])
  assert.deepEqual(calls, [
    { ...input, limit: 100 },
    { ...input, limit: 100, cursor: "page2" },
  ])
  assert.equal(pages.length, 2)
})

test("标签参与缓存键，顺序不影响缓存且不修改原标签数组", () => {
  const key = pageFunction("taskCacheKey")
  assert.notEqual(key(input), key({ ...input, labels: ["Backend"] }))
  assert.notEqual(key(input), key({ ...input, labels: [] }))
  const labels = ["Frontend", "Backend"]
  assert.equal(key({ ...input, labels }), key(input))
  assert.deepEqual(labels, ["Frontend", "Backend"])
})

test("标签从整个项目的任务汇总去重，不拆分逗号且支持后续分页", () => {
  const collect = pageFunction("collectTaskLabels")
  const tasks = Array.from({ length: 100 }, () => ({ labels: ["Backend", "one,two"] }))
  tasks.push({ labels: ["Backend", "Frontend"] })
  const labels: string[] = collect(tasks)
  assert.deepEqual(new Set(labels), new Set(["Backend", "Frontend", "one,two"]))
  assert.equal(labels.length, 3)
  assert.match(source.text, /const input = \{ targetId, projectId \}/)
  assert.match(source.text, /<DropdownMenuLabel>标签<\/DropdownMenuLabel>/)
})

test("标签复选即时应用，取消全部标签恢复不限制标签", () => {
  const hasFilters = pageFunction("hasFilters")
  assert.equal(
    hasFilters({
      keyword: "",
      statuses: [],
      priorities: [],
      assigneeUserIds: [],
      labels: ["Backend"],
    }),
    true,
  )
  for (const labels of [["Backend", "Frontend"], []]) {
    const filters = {
      keyword: " 发布 ",
      statuses: ["todo"],
      priorities: [2],
      assigneeUserIds: ["u1"],
      labels: ["Backend"],
    }
    let applied: unknown
    const change = pageFunction("changeFilter", {
      filters,
      setFilters: () => {},
      setAppliedFilters: (value: unknown) => {
        applied = value
      },
    })
    change("labels", labels)
    assert.deepEqual(applied, { ...filters, keyword: "发布", labels })
  }
})

test("标签目录与同一任务列表共享在途请求，不重复下载且完成后可重新加载", async () => {
  let calls = 0
  let finish!: (value: unknown) => void
  const request = new Promise((resolve) => {
    finish = resolve
  })
  const load = pageFunction("loadAllTasks", {
    window: {
      desktop: {
        accountData: {
          listProjectTasks: async () => {
            calls++
            return request
          },
        },
      },
    },
  })
  const pagesA: unknown[] = [],
    pagesB: unknown[] = []
  const a = load({ targetId: "account", projectId: "project" }, (items: unknown) =>
    pagesA.push(items),
  )
  const b = load({ targetId: "account", projectId: "project", labels: [] }, (items: unknown) =>
    pagesB.push(items),
  )
  assert.equal(calls, 1)
  finish({ ok: true, data: { items: [{ id: "t1", labels: ["Backend"] }], nextCursor: null } })
  const [resultA, resultB] = await Promise.all([a, b])
  assert.deepEqual(resultA, resultB)
  assert.deepEqual(pagesA, pagesB)
  await load({ targetId: "account", projectId: "project" }, () => {})
  assert.equal(calls, 2)
})

test("刷新后不复用前一轮在途请求，失败的共享请求会释放", async () => {
  let calls = 0
  const finishes: Array<(value: unknown) => void> = []
  const pool = new Map()
  const load = pageFunction("loadAllTasks", {
    taskPageLoads: pool,
    window: {
      desktop: {
        accountData: {
          listProjectTasks: async () => {
            calls++
            return new Promise((resolve) => finishes.push(resolve))
          },
        },
      },
    },
  })
  const first = load(input, () => {}, 0)
  const second = load(input, () => {}, 1)
  assert.equal(calls, 2)
  finishes.forEach((finish) => finish({ ok: false, error: { message: "加载任务失败" } }))
  const results = await Promise.allSettled([first, second])
  assert.equal(
    results.every((result) => result.status === "rejected"),
    true,
  )
  assert.equal(pool.size, 0)
})

test("任务页与详情共享可搜索选择器，筛选重置不等于未分配", () => {
  const page = source.text
  const dialog = readFileSync(
    new URL("../src/renderer/features/projects/project-task-dialog.tsx", import.meta.url),
    "utf8",
  )
  const picker = readFileSync(
    new URL("../src/renderer/features/projects/task-assignee-picker.tsx", import.meta.url),
    "utf8",
  )
  for (const text of [page, dialog])
    assert.match(text, /import \{ TaskAssigneePicker \} from "\.\/task-assignee-picker"/)
  assert.match(page, /ariaLabel="筛选负责人"/)
  assert.match(page, /"所有负责人"/)
  assert.match(page, /changeFilter\("assigneeUserIds", id \? \[id\] : \[\]\)/)
  assert.match(picker, /matchesUserSearch\(option\.searchIndex, input\)/)
  assert.match(picker, /aria-label="搜索负责人"/)
  assert.match(picker, /emptyLabel = "未分配"/)
})
