import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import type { ClientConversation, ClientMessage, ClientUser } from "@/core/models"
import { buildPresentedMessages } from "@/domain/messages/message-presenter"

const root = "../src/features/conversation/"
const hookSource = readFileSync(new URL(`${root}messages/use-target-message-navigation.ts`, import.meta.url), "utf8")
const hookCode = ts.transpileModule(hookSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function harness() {
  const slots: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = []
  let cursor = 0, updates = 0
  let effects: (() => void)[] = []
  const requests: { resolve: (value: { isError: boolean }) => void }[] = []
  const timers = new Map<number, { run: () => void; delay: number }>()
  let nextTimer = 0
  const changed = (old: unknown[] | undefined, next: unknown[]) => !old || old.length !== next.length || next.some((value, index) => !Object.is(value, old[index]))
  const react = {
    useRef(value: unknown) { const index = cursor++; slots[index] ??= { value: { current: value } }; return slots[index].value },
    useState(value: unknown) {
      const index = cursor++; slots[index] ??= { value }
      return [slots[index].value, (next: unknown) => { updates++; slots[index].value = typeof next === "function" ? next(slots[index].value) : next }]
    },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const index = cursor++
      if (changed(slots[index]?.deps, deps)) effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: effect() } })
    },
  }
  const fetchOlderMessages = () => new Promise<{ isError: boolean }>((resolve) => requests.push({ resolve }))
  const exports = {} as { useTargetMessageNavigation: (options: Record<string, unknown>) => void }
  runInNewContext(hookCode, {
    exports,
    require(name: string) { assert.equal(name, "react"); return react },
    setTimeout(run: () => void, delay: number) { const id = ++nextTimer; timers.set(id, { run, delay }); return id },
    clearTimeout(id: number) { timers.delete(id) },
  })
  return {
    requests, timers,
    render(overrides: Record<string, unknown> = {}) {
      cursor = 0; effects = []
      exports.useTargetMessageNavigation({ fetchOlderMessages, targetMessageId: "original", scopeKey: "account:room", requestKey: 1, messages: [{ id: "latest" }], hasOlder: true, isLoading: false, isFetchingOlder: false, ...overrides })
      effects.forEach((effect) => effect())
    },
    unmount() { slots.forEach((slot) => slot.cleanup?.()) },
    updates: () => updates,
  }
}

function callback(path: string, name: string, scope: Record<string, unknown>): Function {
  const file = new URL(`${root}${path}`, import.meta.url)
  const source = ts.createSourceFile(file.pathname, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let text = ""
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(source)
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) text = `const ${name} = ${node.initializer.arguments[0].getText(source)}`
    if (name === "focusEffect" && ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("const targetIndex = listItems.findIndex")) text = `const focusEffect = ${node.arguments[0].getText(source)}`
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(text, `missing callback ${name}`)
  const code = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  return new Function(...Object.keys(scope), `${code}; return ${name};`)(...Object.values(scope))
}

test("引用展示模型保留快照和本地回退的原消息ID", () => {
  const original = { id: "original", seq: 1, conversationId: "room", createdAt: "2026-10-14T12:00:00Z", sender: { id: "me", type: "user" }, body: { type: "text", content: "原消息" }, reactions: [] } as ClientMessage
  for (const snapshot of [false, true]) {
    const reply = { ...original, id: "reply", seq: 2, replyToMessageId: "original", replyTo: snapshot ? { id: "original", seq: 1, summary: "原消息", sender: { id: "me", type: "user", name: "我" } } : undefined } as ClientMessage
    const messages = buildPresentedMessages({
      contacts: { apps: [], users: [], groups: [] },
      conversation: { id: "room", type: "direct", members: [], name: "会话" } as unknown as ClientConversation,
      currentUser: { id: "me", avatar: "", name: "我", nickname: "" } as ClientUser,
      messages: snapshot ? [reply] : [original, reply],
      resolveMentionLabel: () => undefined,
    })
    assert.equal(messages.find((message) => message.id === "reply")?.replyTo?.id, "original")
  }
})

test("引用点击发出独立定位请求，同一原消息再次点击递增请求键", () => {
  let request: { scope: string; messageId: string; requestKey: number } | null = null
  let dismisses = 0
  const locate = callback("conversation-screen.tsx", "handleLocateReplyMessage", {
    messageLocationScope: "account:room", Keyboard: { dismiss() { dismisses++ } },
    setReplyLocation: (update: (current: typeof request) => typeof request) => { request = update(request) },
  })
  locate({ replyTo: { id: "original" } })
  locate({ replyTo: { id: "original" } })
  assert.deepEqual(request, { scope: "account:room", messageId: "original", requestKey: 2 })
  assert.equal(dismisses, 2)
})

test("引用短按定位，长按保留消息操作且不误触定位", () => {
  const message = { replyTo: { id: "original" } }
  const long = { current: false }
  let located = 0, opened = 0, stopped = 0
  const scope = { message, didLongPressReplyRef: long, messageActionsEnabled: true, onLocateReplyMessage: () => { located++ }, onMessageLongPress: () => { opened++ } }
  const press = callback("messages/message-bubble.tsx", "handleReplyReferencePress", scope)
  const longPress = callback("messages/message-bubble.tsx", "handleReplyReferenceLongPress", scope)
  press({ stopPropagation() { stopped++ } })
  longPress()
  press({ stopPropagation() { stopped++ } })
  assert.equal(located, 1)
  assert.equal(opened, 1)
  assert.equal(stopped, 2)
})

test("定位目标未加载时逐页加载，找到目标后停止", async () => {
  const hook = harness()
  hook.render()
  assert.equal(hook.requests.length, 1)
  hook.requests[0].resolve({ isError: false })
  await flush()
  hook.render({ messages: [{ id: "latest" }, { id: "older" }] })
  assert.equal(hook.requests.length, 2)
  hook.requests[1].resolve({ isError: false })
  await flush()
  hook.render({ messages: [{ id: "latest" }, { id: "older" }, { id: "original" }] })
  assert.equal(hook.requests.length, 2)
})

test("加载期间不重复分页，已可见消息不额外加载", () => {
  for (const options of [{ isLoading: true }, { isFetchingOlder: true }, { messages: [{ id: "original" }] }]) {
    const hook = harness()
    hook.render(options)
    assert.equal(hook.requests.length, 0)
  }
})

test("历史到尽头仅提示一次，新定位请求可再次提示", () => {
  const hook = harness()
  let missing = 0
  const options = { hasOlder: false, onUnavailable() { missing++ } }
  hook.render(options)
  hook.render(options)
  assert.equal(missing, 1)
  hook.render({ ...options, requestKey: 2 })
  assert.equal(missing, 2)
  assert.equal(hook.requests.length, 0)
})

test("切换引用或账户后，旧失败请求不创建重试定时器", async () => {
  for (const changed of [{ targetMessageId: "another", requestKey: 2 }, { scopeKey: "another-account:room" }]) {
    const hook = harness()
    hook.render()
    hook.render(changed)
    assert.equal(hook.requests.length, 2)
    hook.requests[0].resolve({ isError: true })
    await flush()
    assert.equal(hook.timers.size, 0)
    hook.unmount()
    hook.requests[1].resolve({ isError: true })
    await flush()
    assert.equal(hook.timers.size, 0)
  }
})

test("会话失焦时清空目标，旧失败不会重试或继续加载", async () => {
  const hook = harness()
  hook.render()
  hook.render({ targetMessageId: "" })
  hook.requests[0].resolve({ isError: true })
  await flush()
  assert.equal(hook.requests.length, 1)
  assert.equal(hook.timers.size, 0)
  const screen = readFileSync(new URL(`${root}conversation-screen.tsx`, import.meta.url), "utf8")
  assert.match(screen, /targetMessageId: isFocused \? targetMessageId : ""/)
})

test("网络失败按既有退避重试，卸载后旧定时器不更新状态", async () => {
  const hook = harness()
  hook.render()
  hook.requests[0].resolve({ isError: true })
  await flush()
  const timer = [...hook.timers.values()][0]
  assert.equal(timer.delay, 5000)
  hook.unmount()
  const count = hook.updates()
  timer.run()
  assert.equal(hook.updates(), count)
  assert.equal(hook.timers.size, 0)
})

test("原消息已可见时仍居中并重新高亮，未可见时等待视图可见回调", () => {
  for (const visible of [false, true]) {
    const scrolls: unknown[] = [], completed: string[] = [], frames: Array<() => void> = []
    const pending = { current: "" }
    const effect = callback("messages/message-list.tsx", "focusEffect", {
      initialMessageId: "original", focusedMessageIdRef: { current: "" },
      listItems: [{ type: "message", message: { id: "other" } }, { type: "message", message: { id: "original" } }],
      pendingFocusedMessageIdRef: pending, requestedTargetIndexRef: { current: -1 }, targetScrollRetriesRef: { current: 0 },
      listRef: { current: { scrollToIndex(value: unknown) { scrolls.push(value) } } },
      visibleMessageIdsRef: { current: new Set(visible ? ["original"] : []) }, completeMessageFocus: (id: string) => completed.push(id),
      requestAnimationFrame(run: () => void) { frames.push(run); return 1 }, cancelAnimationFrame() {},
    })
    effect()
    frames[0]()
    assert.deepEqual(scrolls, [{ animated: false, index: 1, viewPosition: 0.5 }])
    assert.deepEqual(completed, visible ? ["original"] : [])
  }
})

test("原消息进入可见区后高亮两秒", () => {
  const highlighted: string[] = [], timers: { run: () => void; delay: number }[] = []
  const pending = { current: "original" }
  const complete = callback("messages/message-list.tsx", "completeMessageFocus", {
    pendingFocusedMessageIdRef: pending, focusedMessageIdRef: { current: "" },
    setHighlightedMessageId: (id: string) => highlighted.push(id), highlightTimerRef: { current: undefined }, clearTimeout() {},
    setTimeout(run: () => void, delay: number) { timers.push({ run, delay }); return 1 },
  })
  const visible = callback("messages/message-list.tsx", "handleViewableItemsChanged", { pendingFocusedMessageIdRef: pending, visibleMessageIdsRef: { current: new Set() }, completeMessageFocus: complete })
  visible({ viewableItems: [{ isViewable: true, item: { type: "message", message: { id: "original" } } }] })
  assert.deepEqual(highlighted, ["original"])
  assert.equal(timers[0].delay, 2000)
  timers[0].run()
  assert.deepEqual(highlighted, ["original", ""])
})
