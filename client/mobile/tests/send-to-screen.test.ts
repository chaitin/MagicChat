import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { buildSendTargetHref, parseSendTargetRequest, sendTargetScope, toggleSendTarget } from "../src/navigation/send-target.ts"

const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")
const session = { id: "server", url: "https://example.test", userId: "user", accessToken: "not-for-route" }
const entity = { type: "user" as const, id: "550e8400-e29b-41d4-a716-446655440000" }
const forwardRequest = { purpose: "forward" as const, sourceConversationId: "source-id", messageId: "message-id" }
const namecardRequest = { purpose: "namecard" as const, entity }

test("转发和名片的路由仅传实体/消息引用与账号作用域，不携带消息预览或凭据", () => {
  for (const request of [forwardRequest, namecardRequest]) {
    const href = buildSendTargetHref(session, 3, request)
    assert.equal(href.pathname, "/send-to")
    assert.deepEqual(parseSendTargetRequest(href.params, sendTargetScope(session, 3)), request)
    assert.doesNotMatch(JSON.stringify(href), /accessToken|not-for-route|author|summary|createdAt/)
    for (const target of [{ ...session, id: "other" }, { ...session, url: "https://other.test" }, { ...session, userId: "other" }]) {
      assert.equal(parseSendTargetRequest(href.params, sendTargetScope(target, 3)), null)
    }
    assert.equal(parseSendTargetRequest(href.params, sendTargetScope(session, 4)), null)
  }
})

test("无效或重复的路由参数不能形成可发送请求", () => {
  const scope = sendTargetScope(session, 3)
  const params = buildSendTargetHref(session, 3, forwardRequest).params
  for (const override of [{ scope: [scope] }, { purpose: "other" }, { messageId: ["message-id"] }, { messageId: "" }, { sourceConversationId: "../source" }]) {
    assert.equal(parseSendTargetRequest({ ...params, ...override }, scope), null)
  }
  const card = buildSendTargetHref(session, 3, namecardRequest).params
  assert.equal(parseSendTargetRequest({ ...card, entityType: "topic" }, scope), null)
  assert.equal(parseSendTargetRequest({ ...card, entityId: "invalid" }, scope), null)
})

test("转发支持多选与取消，名片单选替换；选择更新不修改原集合", () => {
  const original = new Set(["a"])
  assert.deepEqual([...toggleSendTarget(original, "b", "forward")], ["a", "b"])
  assert.deepEqual([...toggleSendTarget(original, "a", "forward")], [])
  assert.deepEqual([...toggleSendTarget(original, "b", "namecard")], ["b"])
  assert.deepEqual([...toggleSendTarget(original, "a", "namecard")], [])
  assert.deepEqual([...original], ["a"])
})

type Element = { type: string; props: Record<string, any>; children: any[] }
function compileFunction(file: string, name: string) {
  const code = source(file)
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name)!
  return ts.transpileModule(`export ${fn.getText(ast).replace(/^export /, "")}`, {
    fileName: "test.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText
}
const React = { createElement: (type: string, props: Record<string, any>, ...children: any[]): Element => ({ type, props, children }) }
function find(node: Element, type: string): Element {
  if (node.type === type) return node
  for (const child of node.children.flat()) {
    if (child && typeof child === "object") { const result = find(child, type); if (result) return result }
  }
  return undefined as unknown as Element
}

test("独立页header为返回/标题/发送，下方搜索列表，无预览、无类型文字；搜索保留已选会话", () => {
  for (const request of [forwardRequest, namecardRequest]) {
    const states: any[] = ["", new Set<string>()]
    let cursor = 0
    const sent: string[][] = []
    let backCount = 0
    let submitting = false
    let hardwareBack: () => boolean = () => false
    const exports: any = {}
    runInNewContext(compileFunction("features/send-to/send-to-screen.tsx", "SendToContent"), {
      exports, React, Set, View: "View", FlatList: "FlatList", KeyboardAwareScreen: "KeyboardAwareScreen", AppHeader: "AppHeader",
      HalfScreenSearchInput: "Search", HalfScreenSelectionRow: "Row", ConversationAvatar: "Avatar", ContentState: "Empty", XGUIButton: "Button",
      Stack: { Screen: "StackScreen" }, Keyboard: { dismiss() {} },
      useAuthenticatedSession: () => session, useXGUITheme: () => ({ colors: { background0: "header-bg", background2: "list-bg" } }),
      useClientData: () => ({ conversations: [
        { id: "a", name: "Alice", type: "direct" }, { id: "b", name: "Bob", type: "group" },
        { id: "no-send", name: "Disabled", canSend: false }, { id: "archived", name: "Archived", topic: { archived: true } },
      ] }),
      useState: () => { const index = cursor++; return [states[index], (value: any) => { states[index] = typeof value === "function" ? value(states[index]) : value }] },
      useMemo: (fn: Function) => fn(), useCallback: (fn: Function) => fn,
      useFocusEffect: (fn: Function) => fn(),
      BackHandler: { addEventListener: (_event: string, fn: () => boolean) => { hardwareBack = fn; return { remove() {} } } },
      useSendToConversations: () => ({ submitting, send: (ids: string[]) => sent.push(ids) }),
      orderConversations: (items: unknown[]) => items, toggleSendTarget,
    })
    const render = () => { cursor = 0; return exports.SendToContent({ request, onBack: () => { backCount++ } }) as Element }
    let tree = render()
    let header = find(tree, "AppHeader")
    assert.equal(header.props.title, request.purpose === "namecard" ? "发送名片" : "转发消息")
    assert.equal(header.props.headerAction.props.disabled, true)
    assert.equal(hardwareBack(), false)
    header.props.onBackPress()
    assert.equal(backCount, 1)
    let list = find(tree, "FlatList")
    assert.deepEqual(Array.from(list.props.data, (item: any) => item.id), ["a", "b"])
    const row = list.props.renderItem({ item: list.props.data[0] }) as Element
    assert.equal(row.props.checkboxPosition, "end")
    assert.equal(row.props.value, undefined)
    assert.equal(row.props.leading.type, "Avatar")
    assert.equal(row.props.leading.props.size, 32)
    assert.equal(find(tree, "View").props.style.backgroundColor, "header-bg")
    assert.equal(tree.props.contentBackground, "list-bg")
    row.props.onPress()
    assert.equal(sent.length, 0)
    tree = render()
    header = find(tree, "AppHeader")
    assert.equal(header.props.headerAction.props.disabled, false)
    assert.equal(header.props.headerAction.children[0], "发送(1)")
    find(tree, "Search").props.onChangeText("  BOB  ")
    tree = render()
    list = find(tree, "FlatList")
    assert.deepEqual(Array.from(list.props.data, (item: any) => item.id), ["b"])
    find(tree, "AppHeader").props.headerAction.props.onPress()
    assert.deepEqual(Array.from(sent[0]), ["a"])
    assert.doesNotMatch(JSON.stringify(tree), /sourcePreview|sourceAuthor|sourceSummary|HalfScreenDialog/)
    submitting = true
    tree = render()
    header = find(tree, "AppHeader")
    assert.equal(header.props.headerAction.props.loading, true)
    assert.equal(header.props.headerAction.props.disabled, true)
    assert.equal(find(tree, "StackScreen").props.options.gestureEnabled, false)
    assert.equal(hardwareBack(), true)
    header.props.onBackPress()
    assert.equal(backCount, 1)
    list = find(tree, "FlatList")
    list.props.renderItem({ item: list.props.data[0] }).props.onPress()
    assert.deepEqual([...states[1]], ["a"])
  }
})

test("发送列表可缩小头像，其他页面默认与compact头像尺寸保持不变", () => {
  const exports: any = {}
  runInNewContext(compileFunction("features/messages/conversation-avatar.tsx", "ConversationAvatar"), {
    exports, React, View: "View", BaseConversationAvatar: "BaseAvatar", XGUIBadge: "Badge", styles: {},
    useXGUITheme: () => ({ colors: {} }),
    getConversationAvatarName: () => "Alice", getConversationAvatarType: () => "user",
  })
  for (const [options, containerSize, avatarSize] of [[{}, 44, 44], [{ compact: true }, 28, 24], [{ size: 36 }, 36, 36]] as const) {
    const tree: Element = exports.ConversationAvatar({ conversation: { type: "direct", unreadCount: 0 }, server: session, ...options })
    assert.equal(tree.props.style.width, containerSize)
    assert.equal(tree.props.style.height, containerSize)
    assert.equal(find(tree, "BaseAvatar").props.size, avatarSize)
  }
  const base: any = {}
  runInNewContext(compileFunction("features/messages/conversation-avatar.tsx", "BaseConversationAvatar"), {
    exports: base, React, AppAvatar: "AppAvatar",
  })
  assert.equal(base.BaseConversationAvatar({ avatarName: "Alice", avatarType: "user", size: 36, conversation: {}, server: session }).props.size, 36)
})

test("公共选择行保留默认左侧选择框，右侧选择框使用20尺寸和fg-3边框", () => {
  const exports: any = {}
  const controls = source("features/conversation/half-screen-selection-controls.tsx")
  const styleExports: any = {}
  runInNewContext(`${controls.slice(controls.indexOf("const styles ="))}\nexports.styles = styles`, {
    exports: styleExports, StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  })
  runInNewContext(compileFunction("features/conversation/half-screen-selection-controls.tsx", "HalfScreenSelectionRow"), {
    exports, React, View: "View", Pressable: "Pressable", Text: "Text", Check: "Check", styles: styleExports.styles,
    useXGUITheme: () => ({ colors: { foreground3: "fg-3", brand: "brand" } }), Boolean,
  })
  for (const position of ["start", "end"]) {
    const row: Element = exports.HalfScreenSelectionRow({ checkbox: true, checkboxPosition: position, title: "Alice", leading: "avatar", selected: true })
    assert.equal(row.props.accessibilityState.checked, true)
    const content: Element = row.children[0]({ pressed: false })
    const children = content.children.filter(Boolean)
    const checkIndex = children.findIndex((item: Element) => find(item, "Check"))
    const textIndex = children.findIndex((item: Element) => item.type === "Text")
    assert.ok(position === "end" ? checkIndex > textIndex : checkIndex < textIndex)
    assert.equal(Object.assign({}, ...children[checkIndex].props.style).backgroundColor, "brand")
    const unchecked: Element = exports.HalfScreenSelectionRow({ checkbox: true, checkboxPosition: position, title: "Alice", selected: false })
    const uncheckedContent: Element = unchecked.children[0]({ pressed: false })
    const checkbox = uncheckedContent.children.filter(Boolean)[position === "start" ? 0 : 1]
    const style = Object.assign({}, ...checkbox.props.style)
    assert.equal(style.borderColor, "fg-3")
    assert.equal(style.borderWidth, 1)
    assert.equal(style.width, 20)
    assert.equal(style.height, 20)
    assert.equal(style.borderRadius, 10)
    assert.equal(find(children[checkIndex], "Check").props.size, 13)
  }
})

function createSender(request: typeof forwardRequest | typeof namecardRequest) {
  const calls: any[] = []
  const notices: any[] = []
  const states: boolean[] = []
  let closed = 0
  let invalidated = 0
  let replaced = ""
  let cleanup: () => void = () => {}
  let cardResponse: () => Promise<any> = async () => ({ id: "card" })
  let forwardResponse: () => Promise<any> = async () => ({ sentCount: 1, failedCount: 0, results: [] })
  const code = source("features/send-to/use-send-to-conversations.ts").replace(/^import .*$/gm, "")
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const exports: any = {}
  let sourceConversation = ""
  runInNewContext(compiled, {
    exports, Error, Map, JSON, crypto: { randomUUID: (() => { let n = 0; return () => `request-${++n}` })() },
    useAuthenticatedSession: () => session,
    useAuth: () => ({ invalidateSession: () => { invalidated++ } }),
    useRouter: () => ({ replace: (path: string) => { replaced = path } }),
    useXGUIToast: () => ({ show: (notice: any) => notices.push(notice) }),
    useState: () => [false, (value: boolean) => states.push(value)], useRef: (current: any) => ({ current }),
    useLayoutEffect: (fn: Function) => { cleanup = fn() },
    useForwardConversationMessage: (target: unknown, id: string) => {
      assert.equal(target, session); sourceConversation = id
      return { mutateAsync: async (input: unknown) => { calls.push({ kind: "forward", input }); return forwardResponse() } }
    },
    sendConversationEntityCardMessage: async (target: unknown, id: string, input: unknown) => {
      assert.equal(target, session); calls.push({ kind: "namecard", id, input }); return cardResponse()
    },
    messageManager: { writeMessages: async (target: unknown, messages: unknown[]) => { assert.equal(target, session); calls.push({ kind: "cache", messages }) } },
    isUnauthorizedError: (error: Error) => error.message === "unauthorized",
  })
  const hook = exports.useSendToConversations(request, () => { closed++ }) as { send: (ids: string[]) => Promise<void> }
  return {
    ...hook, calls, notices, states, sourceConversation, cleanup: () => cleanup(),
    setCardResponse: (fn: typeof cardResponse) => { cardResponse = fn },
    setForwardResponse: (fn: typeof forwardResponse) => { forwardResponse = fn },
    get closed() { return closed }, get invalidated() { return invalidated }, get replaced() { return replaced },
  }
}

test("空选择不发送，名片不接受多选，快速重复确认只发送一次；成功写入本地后返回原页", async () => {
  const sender = createSender(namecardRequest)
  let resolve!: (value: unknown) => void
  sender.setCardResponse(() => new Promise((done) => { resolve = done }))
  await sender.send([])
  await sender.send(["a", "b"])
  assert.equal(sender.calls.length, 0)
  const pending = sender.send(["a"])
  await sender.send(["a"])
  assert.equal(sender.calls.length, 1)
  assert.equal(sender.closed, 0)
  resolve({ id: "card" })
  await pending
  assert.equal(sender.calls[0].input.entityId, entity.id)
  assert.equal(sender.calls[1].kind, "cache")
  assert.equal(sender.notices[0].message, "名片已发送")
  assert.equal(sender.closed, 1)
  assert.deepEqual(sender.states, [true, false])
})

test("名片和转发失败保持页面、重试复用请求ID；转发保留原始会话和消息引用", async () => {
  for (const request of [namecardRequest, forwardRequest]) {
    const sender = createSender(request)
    const fail = async () => { throw new Error("network failed") }
    if (request.purpose === "namecard") sender.setCardResponse(fail)
    else sender.setForwardResponse(fail)
    await sender.send(["a"])
    await sender.send(["a"])
    const calls = sender.calls.filter((item) => item.kind !== "cache")
    assert.equal(calls.length, 2)
    assert.equal(calls[0].input.clientMessageId ?? calls[0].input.clientForwardId, calls[1].input.clientMessageId ?? calls[1].input.clientForwardId)
    assert.equal(sender.closed, 0)
    assert.equal(sender.notices[0].message, "network failed")
    if (request.purpose === "forward") {
      assert.equal(sender.sourceConversation, request.sourceConversationId)
      assert.equal(calls[0].input.messageId, request.messageId)
    }
  }
})

test("转发全部失败不退出，部分成功提示数量并返回，账号失效进入服务器管理", async () => {
  const sender = createSender(forwardRequest)
  sender.setForwardResponse(async () => ({ sentCount: 0, failedCount: 1, results: [{ status: "failed", error: { message: "不可发送" } }] }))
  await sender.send(["a"])
  assert.equal(sender.closed, 0)
  assert.equal(sender.notices[0].message, "不可发送")
  sender.setForwardResponse(async () => ({ sentCount: 1, failedCount: 1, results: [] }))
  await sender.send(["a", "b"])
  assert.equal(sender.closed, 1)
  assert.equal(sender.notices[1].message, "已转发到 1 个会话，1 个失败")
  const unauthorized = createSender(forwardRequest)
  unauthorized.setForwardResponse(async () => { throw new Error("unauthorized") })
  await unauthorized.send(["a"])
  assert.equal(unauthorized.invalidated, 1)
  assert.equal(unauthorized.replaced, "/server-management")
})

test("离开发送页或切换账号后，迟到的响应不能弹提示或导航新页面", async () => {
  for (const reject of [false, true]) {
    const sender = createSender(forwardRequest)
    let finish!: () => void
    sender.setForwardResponse(() => new Promise((resolve, fail) => { finish = () => reject ? fail(new Error("network failed")) : resolve({ sentCount: 1, failedCount: 0, results: [] }) }))
    const pending = sender.send(["a"])
    sender.cleanup()
    finish()
    await pending
    assert.equal(sender.closed, 0)
    assert.equal(sender.notices.length, 0)
    assert.deepEqual(sender.states, [true])
    await sender.send(["a"])
    assert.equal(sender.calls.length, 1)
  }
})
