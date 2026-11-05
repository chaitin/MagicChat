import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import type { DesktopConversation } from "../src/shared/account-data.ts"
import { groupConversationList } from "../src/renderer/features/chat/conversation-list-order.ts"
import { canPinConversation } from "../src/renderer/features/chat/conversation-action-policy.ts"
import * as unread from "../src/renderer/features/chat/conversation-unread.ts"

type Node = { type: any; props: Record<string, any> }
type Row = { id: string; unread: boolean }
const chatPath = "../src/renderer/features/chat/chat-page.tsx"
const chatSource = ts.createSourceFile(
  chatPath,
  readFileSync(new URL(chatPath, import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
const jsx = (type: unknown, props: any): Node => ({ type, props })
const noop = () => {}

function bind(source: string, scope: Record<string, unknown>) {
  const code = ts.transpileModule("const value = " + source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(scope), code + "\nreturn value;")(...Object.values(scope))
}

function callback(scope: Record<string, unknown>): (section: string) => void {
  let body = ""
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(chatSource) === "selectSection") {
      assert.ok(node.initializer && ts.isCallExpression(node.initializer))
      body = node.initializer.arguments[0].getText(chatSource)
    }
    ts.forEachChild(node, visit)
  }
  visit(chatSource)
  assert.ok(body, "未找到实际页面导航回调")
  return bind(body, scope)
}

function prop(component: string, name: string, scope: Record<string, unknown>) {
  let expression = ""
  function visit(node: ts.Node) {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(chatSource) === component
    ) {
      const attribute = node.attributes.properties.find(
        (value): value is ts.JsxAttribute =>
          ts.isJsxAttribute(value) && value.name.getText(chatSource) === name,
      )
      if (attribute?.initializer && ts.isJsxExpression(attribute.initializer))
        expression = attribute.initializer.expression?.getText(chatSource) ?? ""
    }
    ts.forEachChild(node, visit)
  }
  visit(chatSource)
  assert.ok(expression, "未找到组件连接：" + component + "." + name)
  return bind(expression, scope)
}

function component(path: string, name: string) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const module = { exports: {} as any }
  runInNewContext(code, {
    module,
    exports: module.exports,
    window: { desktop: undefined },
    require: (name: string) => {
      if (name === "react")
        return {
          memo: (fn: Function) => fn,
          useMemo: (fn: Function) => fn(),
          useState: (initial: any) => [typeof initial === "function" ? initial() : initial, noop],
          useEffect: noop,
        }
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" }
      if (name === "../conversation-list-order") return { groupConversationList }
      if (name === "../conversation-action-policy") return { canPinConversation }
      if (name === "../conversation-unread") return unread
      if (name === "../conversation-list-preview") return { formatConversationSummary: () => "" }
      if (name.endsWith("animated-toast-provider"))
        return { useAnimatedToast: () => ({ showToast: noop }) }
      if (name === "@/lib/utils") return { cn: () => "" }
      return new Proxy({}, { get: (_target, key) => key })
    },
  })
  return module.exports[name]
}

const Sidebar = component(
  "../src/renderer/features/chat/components/conversation-sidebar.tsx",
  "ConversationSidebar",
)
const Rail = component("../src/renderer/features/chat/components/app-navigation.tsx", "AppRail")

function nodes(node: any): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!node || typeof node !== "object") return []
  if (typeof node.type === "function") return nodes(node.type(node.props))
  return [node, ...nodes(node.props?.children)]
}

function conversation(
  id: string,
  overrides: Partial<DesktopConversation> = {},
): DesktopConversation {
  return {
    id,
    name: id,
    type: "group",
    memberCount: 2,
    avatarType: "group",
    avatarId: id,
    createdAt: "2026-10-01T00:00:00Z",
    lastMessageAt: "2026-11-01T00:00:00Z",
    lastMessageSummary: "",
    pinned: false,
    notificationMuted: false,
    isBuiltinAssistant: false,
    unreadCount: 0,
    ...overrides,
  }
}

function sidebar(
  conversations: DesktopConversation[],
  selectedId: string | null = null,
  loading = false,
) {
  const viewportRef = { current: null as any }
  const selections: string[] = []
  const passedRef = prop("ConversationSidebar", "viewportRef", { conversationListRef: viewportRef })
  const elements = nodes(
    Sidebar({
      viewportRef: passedRef,
      conversations,
      selectedId,
      loading,
      currentUserId: "user",
      targetId: "account",
      draftConversationIds: new Set(),
      resolvedTheme: "light",
      mentionLabelResolver: () => "",
      onSelect: (id: string) => selections.push(id),
      onCreateGroup: noop,
      onCreateApp: noop,
      onCreateProject: noop,
      onRefresh: noop,
      onSelectSearchResult: noop,
      onSearchResultCloseAutoFocus: noop,
      onSetPinned: noop,
      onSetMuted: noop,
      onDismiss: noop,
    }),
  )
  assert.equal(elements.find((node) => node.type === "ScrollArea")?.props.viewportRef, viewportRef)
  const rows: Row[] = elements
    .filter((node) => node.type === "button")
    .map((node) => {
      const avatar = [node.props.children].flat().find((child) => child?.props?.conversation)
      assert.ok(avatar)
      return {
        id: avatar.props.conversation.id,
        unread: node.props["data-unread-conversation"] !== undefined,
      }
    })
  return { viewportRef, rows, selections }
}

function viewport(initialRows: Row[], initialScrollTop = 500) {
  let rows = initialRows,
    scrollTop = initialScrollTop
  const scrolls: Array<{ top: number; behavior: string }> = []
  const queries: string[] = []
  const located: string[] = []
  return {
    scrolls,
    queries,
    located,
    get scrollTop() {
      return scrollTop
    },
    getBoundingClientRect: () => ({ top: 40 }),
    querySelector(selector: string) {
      queries.push(selector)
      assert.equal(selector, "button[data-unread-conversation]")
      const index = rows.findIndex((row) => row.unread)
      if (index < 0) return null
      located.push(rows[index].id)
      return { getBoundingClientRect: () => ({ top: 40 + index * 64 + 8 - scrollTop }) }
    },
    scrollTo(options: { top: number; behavior: string }) {
      scrolls.push({ ...options })
      scrollTop = options.top
    },
    update(nextRows: Row[]) {
      rows = nextRows
    },
  }
}

function navigation(activeSection: string, conversationListRef: { current: any }) {
  const sections: string[] = [],
    selected: string[] = [],
    marked: string[] = []
  const setActiveSection = (value: string) => sections.push(value)
  const selectSection = callback({
    activeSection,
    conversationListRef,
    setActiveSection,
    setSelectedId: (id: string) => selected.push(id),
    markConversationRead: (id: string) => marked.push(id),
    historyRef: { current: { scrollTo: () => assert.fail("不能滚动右侧聊天记录") } },
    document: { querySelector: () => assert.fail("不能查询全局或其他账号的列表") },
  })
  const onSectionChange = prop("AppRail", "onSectionChange", { selectSection, setActiveSection })
  const elements = nodes(
    Rail({
      activeSection,
      onSectionChange,
      hasUnreadMessages: true,
      targetId: "account",
      serverUrl: "https://example.test",
      userId: "user",
      userName: "用户",
      userEmail: "user@example.test",
      resolvedTheme: "light",
      theme: "light",
      catalog: { servers: [] },
      isPreview: false,
      onSignOut: noop,
      onUserUpdated: noop,
      onRequestQuit: noop,
      onThemeChange: noop,
      onCatalogChange: noop,
    }),
  )
  return {
    sections,
    selected,
    marked,
    click(label = "聊天") {
      const button = elements.find(
        (node) => node.type === "Button" && String(node.props["aria-label"]).startsWith(label),
      )
      assert.ok(button, "未找到真实主导航按钮：" + label)
      button.props.onClick()
    },
  }
}

test("再次点击真实聊天按钮仅将左侧列表滚动到第一条未读，不打开或清除会话", () => {
  const conversations = [
    conversation("read", { lastMessageAt: "2026-11-05T00:00:00Z" }),
    conversation("first", { unreadCount: 3 }),
    conversation("second", { unreadCount: 2 }),
  ]
  const snapshot = JSON.stringify(conversations)
  const list = sidebar(conversations, "read")
  assert.deepEqual(
    list.rows.map((row) => row.id),
    ["read", "first", "second"],
  )
  const view = viewport(list.rows)
  list.viewportRef.current = view
  const nav = navigation("chat", list.viewportRef)
  nav.click()
  assert.deepEqual(view.located, ["first"])
  assert.deepEqual(view.scrolls, [{ top: 72, behavior: "smooth" }])
  assert.deepEqual(nav.sections, [])
  assert.deepEqual(nav.selected, [])
  assert.deepEqual(nav.marked, [])
  assert.deepEqual(list.selections, [])
  assert.equal(JSON.stringify(conversations), snapshot)
})

test("首条未读在视口下方时也按列表内坐标正确滚动定位", () => {
  const list = sidebar([
    ...Array.from({ length: 8 }, (_, index) => conversation("read-" + index)),
    conversation("unread", { unreadCount: 1 }),
  ])
  const view = viewport(list.rows, 0)
  list.viewportRef.current = view
  navigation("chat", list.viewportRef).click()
  assert.deepEqual(view.located, ["unread"])
  assert.deepEqual(view.scrolls, [{ top: 520, behavior: "smooth" }])
})

test("最上面的未读按实际显示顺序计算，置顶会话优先于较新的普通会话", () => {
  const list = sidebar([
    conversation("recent", { unreadCount: 4, lastMessageAt: "2026-11-05T00:00:00Z" }),
    conversation("pinned", { pinned: true, unreadCount: 1, lastMessageAt: "2026-10-01T00:00:00Z" }),
  ])
  assert.deepEqual(
    list.rows.map((row) => row.id),
    ["pinned", "recent"],
  )
  const view = viewport(list.rows)
  list.viewportRef.current = view
  navigation("chat", list.viewportRef).click()
  assert.deepEqual(view.located, ["pinned"])
})

test("话题按父子会话的渲染位置定位，而不是原始数组或单独时间排序", () => {
  const topic = conversation("topic", {
    type: "topic",
    unreadCount: 2,
    lastMessageAt: "2026-11-04T00:00:00Z",
    topic: {
      parentConversationId: "parent",
      archived: false,
      participating: true,
      sourceSender: { id: "u", name: "U", type: "user" },
    },
  })
  const list = sidebar([conversation("other", { unreadCount: 1 }), topic, conversation("parent")])
  assert.deepEqual(
    list.rows.map((row) => row.id),
    ["parent", "topic", "other"],
  )
  const view = viewport(list.rows)
  list.viewportRef.current = view
  navigation("chat", list.viewportRef).click()
  assert.deepEqual(view.located, ["topic"])
})

test("当前会话隐藏未读提示时不把它当作定位目标", () => {
  const list = sidebar(
    [conversation("selected", { unreadCount: 5 }), conversation("unread", { unreadCount: 2 })],
    "selected",
  )
  const view = viewport(list.rows)
  list.viewportRef.current = view
  navigation("chat", list.viewportRef).click()
  assert.deepEqual(view.located, ["unread"])
  assert.deepEqual(list.selections, [])
})

test("免打扰会话显示未读圆点时也按列表顺序参与定位", () => {
  const list = sidebar([
    conversation("muted", { unreadCount: 2, notificationMuted: true }),
    conversation("unread", { unreadCount: 1 }),
  ])
  const view = viewport(list.rows)
  list.viewportRef.current = view
  navigation("chat", list.viewportRef).click()
  assert.deepEqual(view.located, ["muted"])
})

for (const kind of ["all-read", "empty", "loading"]) {
  test(kind + "时重复点击不滚动，也不改变当前会话", () => {
    const list = sidebar(
      kind === "empty" ? [] : [conversation("read", { unreadCount: kind === "loading" ? 1 : 0 })],
      null,
      kind === "loading",
    )
    const view = viewport(list.rows)
    list.viewportRef.current = view
    const nav = navigation("chat", list.viewportRef)
    nav.click()
    assert.equal(view.scrollTop, 500)
    assert.deepEqual(view.scrolls, [])
    assert.deepEqual(nav.sections, [])
    assert.deepEqual(nav.selected, [])
  })
}

test("视口尚未挂载或已经卸载时点击安全地不动作", () => {
  const nav = navigation("chat", { current: null })
  nav.click()
  assert.deepEqual(nav.sections, [])
  assert.deepEqual(nav.selected, [])
})

for (const count of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  test("无有效未读提示时不定位：" + count, () => {
    const list = sidebar([conversation("invalid", { unreadCount: count })])
    const view = viewport(list.rows)
    list.viewportRef.current = view
    navigation("chat", list.viewportRef).click()
    assert.deepEqual(view.scrolls, [])
  })
}

for (const section of ["contacts", "projects"]) {
  test("从" + section + "点击聊天只执行原导航，不附带未读定位", () => {
    const list = sidebar([conversation("unread", { unreadCount: 1 })])
    const view = viewport(list.rows)
    list.viewportRef.current = view
    const nav = navigation(section, list.viewportRef)
    nav.click()
    assert.deepEqual(nav.sections, ["chat"])
    assert.deepEqual(view.queries, [])
    assert.deepEqual(view.scrolls, [])
  })
}

test("聊天页点击其他导航仍正常切换，不触发滚动", () => {
  const view = viewport([{ id: "unread", unread: true }])
  const nav = navigation("chat", { current: view })
  nav.click("通讯录")
  nav.click("项目管理")
  assert.deepEqual(nav.sections, ["contacts", "projects"])
  assert.deepEqual(view.queries, [])
})

test("反复点击始终定位最上面一条未读，而不是依次循环或打开会话", () => {
  const view = viewport([
    { id: "first", unread: true },
    { id: "second", unread: true },
  ])
  const nav = navigation("chat", { current: view })
  nav.click()
  nav.click()
  assert.deepEqual(view.located, ["first", "first"])
  assert.equal(view.scrolls.length, 2)
  assert.deepEqual(nav.selected, [])
})

test("每次点击读取当前列表，新消息和已读更新后定位最新的首条未读", () => {
  const view = viewport([
    { id: "first", unread: true },
    { id: "second", unread: true },
  ])
  const nav = navigation("chat", { current: view })
  nav.click()
  view.update([
    { id: "first", unread: false },
    { id: "second", unread: true },
  ])
  nav.click()
  assert.deepEqual(view.located, ["first", "second"])
})
