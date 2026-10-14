import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { createUserSearchIndex, matchesUserSearch } from "../src/shared/user-search.ts"

const path = new URL("../src/renderer/features/projects/project-create-dialog.tsx", import.meta.url)
const source = ts.createSourceFile(
  path.pathname,
  readFileSync(path, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)

function callback(name: string, scope: Record<string, unknown>): Function {
  let declaration = "",
    maximum = "",
    canCreate = ""
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name)
      declaration = node.getText(source)
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const key = node.name.getText(source)
      if (key === "maxProjectGroupCount") maximum = node.initializer.getText(source)
      if (key === "canCreate") canCreate = node.initializer.getText(source)
      if (key === name && ts.isCallExpression(node.initializer)) {
        declaration = `const ${name} = ${node.initializer.arguments[0].getText(source)}`
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(declaration, `未找到创建项目回调 ${name}`)
  const compiled = ts.transpileModule(
    `const maxProjectGroupCount = ${maximum};\n${name === "submit" ? `const canCreate = ${canCreate};` : ""}\n${declaration}`,
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    },
  ).outputText
  return new Function(...Object.keys(scope), `${compiled}\nreturn ${name};`)(
    ...Object.values(scope),
  )
}

function submitHarness(result: () => Promise<unknown>, overrides: Record<string, unknown> = {}) {
  const requests: unknown[] = [],
    notices: unknown[] = [],
    created: unknown[] = [],
    states: boolean[] = []
  const mounted = { current: true }
  const submit = callback("submit", {
    name: "  新项目  ",
    loading: false,
    creating: false,
    selectedGroupIds: new Set(["group-a", "group-b"]),
    targetId: "account",
    mounted,
    window: {
      desktop: {
        accountData: {
          createProject: async (input: unknown) => {
            requests.push(input)
            return result()
          },
        },
      },
    },
    setCreating: (value: boolean) => states.push(value),
    showToast: (value: unknown) => notices.push(value),
    onCreated: (value: unknown) => created.push(value),
    ...overrides,
  })
  return {
    send: () => submit({ preventDefault() {} }),
    requests,
    notices,
    created,
    states,
    mounted,
  }
}

const project = { id: "new-project", name: "新项目", description: "" }

test("创建成功提交去空白名称、群聊和固定账户，并通知导航", async () => {
  const harness = submitHarness(async () => ({ ok: true, data: project }))
  await harness.send()
  assert.deepEqual(harness.requests, [
    { targetId: "account", name: "新项目", groupIds: ["group-a", "group-b"] },
  ])
  assert.deepEqual(harness.created, [project])
  assert.deepEqual(harness.notices, [{ title: "项目已创建", status: "success" }])
  assert.deepEqual(harness.states, [true, false])
})

test("关联群聊可留空，项目仍可创建", async () => {
  const harness = submitHarness(async () => ({ ok: true, data: project }), {
    selectedGroupIds: new Set(),
  })
  await harness.send()
  assert.deepEqual(harness.requests, [{ targetId: "account", name: "新项目", groupIds: [] }])
})

test("空名称、加载和提交期间不发送创建请求", async () => {
  for (const overrides of [{ name: "  " }, { loading: true }, { creating: true }]) {
    const harness = submitHarness(async () => ({ ok: true, data: project }), overrides)
    await harness.send()
    assert.deepEqual(harness.requests, [])
  }
})

test("创建失败显示服务端原因，保持弹窗且恢复提交状态", async () => {
  const harness = submitHarness(async () => ({ ok: false, error: { message: "群聊不可关联" } }))
  await harness.send()
  assert.deepEqual(harness.created, [])
  assert.deepEqual(harness.notices, [{ title: "群聊不可关联", status: "error" }])
  assert.deepEqual(harness.states, [true, false])
})

test("切换账户或关闭后忽略旧创建结果", async () => {
  let resolve!: (value: unknown) => void
  const pending = new Promise((done) => {
    resolve = done
  })
  const harness = submitHarness(() => pending)
  const sending = harness.send()
  harness.mounted.current = false
  resolve({ ok: true, data: project })
  await sending
  assert.deepEqual(harness.created, [])
  assert.deepEqual(harness.notices, [])
})

test("关联群聊最多100个，仍可取消选择后换选", () => {
  let selected = new Set(Array.from({ length: 100 }, (_, index) => `group-${index}`))
  const before = selected
  const toggle = callback("toggleGroup", {
    setSelectedGroupIds: (update: (current: Set<string>) => Set<string>) => {
      selected = update(selected)
    },
  })
  toggle("extra", true)
  assert.equal(selected, before)
  toggle("group-0", false)
  assert.equal(selected.size, 99)
  assert.equal(before.size, 100)
  toggle("extra", true)
  assert.equal(selected.size, 100)
  assert.equal(selected.has("extra"), true)
})

test("群聊搜索支持名称、拼音和首字母", () => {
  const groups = [
    { id: "a", name: "研发团队" },
    { id: "b", name: "产品讨论" },
  ]
  const indexedGroups = callback("indexedGroups", { groups, createUserSearchIndex })()
  for (const groupKeyword of ["研发", "yanfa", "yf"]) {
    const filtered = callback("filteredGroups", {
      indexedGroups,
      groupKeyword,
      matchesUserSearch,
    })()
    assert.deepEqual(filtered, [groups[0]])
  }
})

test("提交期间禁止关闭弹窗", () => {
  for (const creating of [false, true]) {
    let closes = 0
    callback("handleOpenChange", {
      creating,
      onClose: () => {
        closes++
      },
    })(false)
    assert.equal(closes, creating ? 0 : 1)
  }
})

test("创建成功关闭弹窗，切换项目区并选择新项目", () => {
  const chatPath = new URL("../src/renderer/features/chat/chat-page.tsx", import.meta.url)
  const chatSource = ts.createSourceFile(
    chatPath.pathname,
    readFileSync(chatPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let text = ""
  function visit(node: ts.Node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(chatSource) === "ProjectCreateDialog"
    ) {
      const attribute = node.attributes.properties.find(
        (item) => ts.isJsxAttribute(item) && item.name.getText(chatSource) === "onCreated",
      )
      assert.ok(
        attribute &&
          ts.isJsxAttribute(attribute) &&
          attribute.initializer &&
          ts.isJsxExpression(attribute.initializer) &&
          attribute.initializer.expression,
      )
      text = attribute.initializer.expression.getText(chatSource)
    }
    ts.forEachChild(node, visit)
  }
  visit(chatSource)
  assert.ok(text)
  const changes: unknown[] = []
  const compiled = ts.transpileModule(`const onCreated = ${text}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const onCreated = new Function(
    "targetId",
    "setCreateProjectTarget",
    "setCreatedProject",
    "setActiveSection",
    `${compiled}\nreturn onCreated;`,
  )(
    "account",
    (value: unknown) => changes.push(value),
    (value: unknown) => changes.push(value),
    (value: unknown) => changes.push(value),
  )
  onCreated(project)
  assert.deepEqual(changes, [null, { targetId: "account", id: "new-project" }, "projects"])
  const page = readFileSync(
    new URL("../src/renderer/features/projects/projects-page.tsx", import.meta.url),
    "utf8",
  )
  assert.match(page, /useState<string \| null>\(createdProjectId\)/)
  assert.match(page, /if \(createdProjectId\) setSelectedId\(createdProjectId\)/)
})

test("创建项目菜单与侧栏项目管理使用相同图标", () => {
  const menu = readFileSync(
    new URL("../src/renderer/components/sidebar-search-header.tsx", import.meta.url),
    "utf8",
  )
  const navigation = readFileSync(
    new URL("../src/renderer/features/chat/components/app-navigation.tsx", import.meta.url),
    "utf8",
  )
  assert.match(menu, /onSelect=\{onCreateProject\}>\s*<HugeiconsIcon icon=\{FolderClosedIcon\}/)
  assert.match(navigation, /id: "projects", label: "项目管理", icon: FolderClosedIcon/)
})

test("移除独立任务导航和占位分支，保留项目内任务页面", () => {
  const navigation = readFileSync(
    new URL("../src/renderer/features/chat/components/app-navigation.tsx", import.meta.url),
    "utf8",
  )
  assert.doesNotMatch(navigation, /AppleReminderIcon|"tasks"|tasks: "任务"/)
  const projects = readFileSync(
    new URL("../src/renderer/features/projects/projects-page.tsx", import.meta.url),
    "utf8",
  )
  assert.match(projects, /<ProjectTasksPage/)
})

test("会话、通讯录和项目菜单均转接创建项目入口", () => {
  const menu = readFileSync(
    new URL("../src/renderer/components/sidebar-search-header.tsx", import.meta.url),
    "utf8",
  )
  assert.match(menu, /onSelect=\{onCreateProject\}[\s\S]*?创建项目/)
  for (const file of [
    "chat/components/conversation-sidebar",
    "contacts/contacts-page",
    "projects/projects-page",
  ]) {
    const text = readFileSync(
      new URL(`../src/renderer/features/${file}.tsx`, import.meta.url),
      "utf8",
    )
    assert.match(text, /onCreateProject=\{onCreateProject\}/)
  }
})
