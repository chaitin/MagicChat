import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import type { DesktopConversation, DesktopMessage } from "../src/shared/account-data.ts"

const require = createRequire(import.meta.url)
const renderer = path.resolve(import.meta.dirname, "../src/renderer")
const hookFile = path.join(renderer, "features/chat/hooks/use-chat-data.ts")
const same = (a?: unknown[], b?: unknown[]) =>
  Boolean(a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i])))

type Slot = { value?: any; deps?: unknown[]; cleanup?: () => void }
type Pending<T> = { input: any; resolve: (value: { ok: true; data: T }) => void }

function fixture(focused = true) {
  const slots: Slot[] = []
  let cursor = 0,
    dirty = true
  let jobs: Array<() => void> = []
  let data: any
  const readCalls: number[] = []
  const readAttempts: number[] = []
  let nativeFocused = true
  let revision = 0
  const listeners = new Set<(event: unknown) => void>()
  const frames = new Map<number, () => void>()
  let frameId = 0
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    hasFocus: () => focused,
  })
  const window = Object.assign(new EventTarget(), {
    desktop: {} as any,
    requestAnimationFrame: (fn: () => void) => {
      frames.set(++frameId, fn)
      return frameId
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  })
  const props = { targetId: "target", userId: "me", userName: "我", activeSection: "chat" }
  const memo = (compute: () => unknown, deps: unknown[]) => {
    const slot = (slots[cursor++] ??= {})
    if (!same(slot.deps, deps)) {
      slot.value = compute()
      slot.deps = deps
    }
    return slot.value
  }
  const effect = (fn: () => (() => void) | void, deps: unknown[]) => {
    const slot = (slots[cursor++] ??= {})
    if (same(slot.deps, deps)) return
    slot.deps = deps
    jobs.push(() => {
      slot.cleanup?.()
      slot.cleanup = fn() || undefined
    })
  }
  const react = {
    useState(initial: any) {
      const slot = (slots[cursor++] ??= {
        value: typeof initial === "function" ? initial() : initial,
      })
      return [
        slot.value,
        (next: any) => {
          const value = typeof next === "function" ? next(slot.value) : next
          if (!Object.is(value, slot.value)) {
            slot.value = value
            dirty = true
          }
        },
      ]
    },
    useRef(initial: unknown) {
      return (slots[cursor++] ??= { value: { current: initial } }).value
    },
    useMemo: memo,
    useCallback: (fn: Function, deps: unknown[]) => memo(() => fn, deps),
    useEffect: effect,
    useLayoutEffect: effect,
  }
  const modules = new Map<string, { exports: any }>()
  const showToast = () => {}
  function load(file: string): any {
    const cached = modules.get(file)
    if (cached) return cached.exports
    const module = { exports: {} }
    modules.set(file, module)
    const source = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    runInNewContext(source, {
      module,
      exports: module.exports,
      window,
      document,
      ResizeObserver: undefined,
      setTimeout,
      clearTimeout,
      require: (name: string) => {
        if (name === "react") return react
        if (name === "@/components/motion/animated-toast-provider")
          return { useAnimatedToast: () => ({ showToast }) }
        if (!name.startsWith(".") && !name.startsWith("@/")) return require(name)
        let resolved = name.startsWith("@/")
          ? path.join(renderer, name.slice(2))
          : path.resolve(path.dirname(file), name)
        if (!existsSync(resolved)) resolved += existsSync(`${resolved}.ts`) ? ".ts" : ".tsx"
        return load(resolved)
      },
    })
    return module.exports
  }
  const { useChatData } = load(hookFile)
  const conversations = [
    {
      id: "room",
      type: "group",
      name: "群",
      members: [],
      unreadCount: 3,
      lastReadSeq: 0,
      lastMessageSeq: 3,
    },
  ] as unknown as DesktopConversation[]
  const row = (seq: number) =>
    ({
      id: `m${seq}`,
      conversationId: "room",
      seq,
      senderType: conversations[0].type === "app" ? "app" : "user",
      senderId: "other",
      senderName: "其他用户",
      isMine: false,
      content: `消息${seq}`,
      reactions: [],
    }) as unknown as DesktopMessage
  let rows = [row(1), row(2), row(3)]
  const conversationRequests: Pending<DesktopConversation[]>[] = []
  const messageRequests: Pending<DesktopMessage[]>[] = []
  const emit = (domains = ["conversations", "messages"]) => {
    const event = {
      targetId: props.targetId,
      revision: ++revision,
      domains,
      conversationIds: ["room"],
    }
    for (const listener of listeners) listener(event)
  }
  const runtimeFile = path.resolve(import.meta.dirname, "../src/main/account/account-runtime.ts")
  const ast = ts.createSourceFile(
    runtimeFile,
    readFileSync(runtimeFile, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  )
  let method = ""
  function find(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === "markConversationRead")
      method = node.getText(ast)
    ts.forEachChild(node, find)
  }
  find(ast)
  assert.ok(method)
  const compiled = ts.transpileModule(`class Runtime { ${method} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mark = new Function(`${compiled}; return Runtime.prototype.markConversationRead;`)()
  const runtime = {
    assertInitialized() {},
    notifyChanged: emit,
    conversationManager: {
      markRead: async (_id: string, seq: number) => {
        readCalls.push(seq)
        const conversation = conversations[0]
        if (seq <= (conversation.lastReadSeq ?? 0)) return
        conversation.lastReadSeq = seq
        conversation.unreadCount = Math.max(0, (conversation.lastMessageSeq ?? 0) - seq)
        emit(["conversations"])
      },
    },
  }
  window.desktop.accountData = {
    onChanged: (fn: (event: unknown) => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    listConversations: (input: unknown) =>
      new Promise((resolve) => conversationRequests.push({ input, resolve })),
    listMessages: (input: unknown) =>
      new Promise((resolve) => messageRequests.push({ input, resolve })),
    getContacts: async () => ({ ok: true, data: { users: [], apps: [], groups: [] } }),
    resolveUserNames: async () => ({ ok: true, data: [] }),
    markConversationRead: async ({
      conversationId,
      upToSeq,
    }: {
      conversationId: string
      upToSeq: number
    }) => {
      readAttempts.push(upToSeq)
      if (!nativeFocused)
        return { ok: false, error: { code: "window_inactive", message: "窗口尚未就绪" } }
      return { ok: true, data: await mark.call(runtime, conversationId, upToSeq) }
    },
  }
  async function flush() {
    for (let step = 0; step < 30; step++) {
      for (let i = 0; i < 8; i++) await Promise.resolve()
      if (!dirty) return
      dirty = false
      cursor = 0
      data = useChatData(props)
      const effects = jobs
      jobs = []
      for (const run of effects) run()
    }
    throw new Error(
      `聊天状态未稳定：同一消息已读请求${readCalls.length}次，消息读取${messageRequests.length}个`,
    )
  }
  return {
    flush,
    conversations,
    readCalls,
    readAttempts,
    get data() {
      return data
    },
    conversationRequests,
    messageRequests,
    nativeFocus: (value: boolean) => {
      nativeFocused = value
    },
    async frame() {
      const pending = [...frames.values()]
      frames.clear()
      for (const fn of pending) fn()
      await flush()
    },
    async enter(conversationId = "room") {
      await flush()
      conversationRequests.shift()!.resolve({ ok: true, data: structuredClone(conversations) })
      await flush()
      data.setSelectedId(conversationId)
      await flush()
    },
    async messages(index = messageRequests.length - 1, value = rows) {
      messageRequests.splice(index, 1)[0].resolve({ ok: true, data: structuredClone(value) })
      await flush()
    },
    async lists() {
      for (let i = 0; conversationRequests.length && i < 5; i++) {
        conversationRequests.shift()!.resolve({ ok: true, data: structuredClone(conversations) })
        await flush()
      }
    },
    async receive(seq: number, domains = ["conversations", "messages"]) {
      rows = [...rows, row(seq)]
      conversations[0].lastMessageSeq = seq
      conversations[0].unreadCount = Math.max(0, seq - (conversations[0].lastReadSeq ?? 0))
      emit(domains)
      await flush()
    },
    cleanup() {
      for (const slot of slots) slot.cleanup?.()
    },
  }
}

test("完整聊天生命周期：列表快照延迟时，同一消息只确认一次且不反复取消消息读取", async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  await f.enter()
  await f.messages()
  assert.deepEqual(f.readCalls, [3])
  assert.equal(f.data.loadingMessages, false)
  await f.lists()
  assert.equal(f.data.selected.unreadCount, 0)
  assert.deepEqual(f.readCalls, [3])
  assert.equal(f.messageRequests.length, 0)
})

test("完整聊天生命周期：列表摘要和当前消息窗口一起更新，不需要切走再切回", async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  await f.enter()
  await f.messages()
  await f.lists()
  await f.receive(4)
  await f.messages()
  await f.lists()
  assert.deepEqual(
    Array.from(f.data.messages, (row: DesktopMessage) => row.seq),
    [1, 2, 3, 4],
  )
  assert.equal(f.data.selected.lastMessageSeq, 4)
  assert.equal(f.data.selected.unreadCount, 0)
  assert.deepEqual(f.readCalls, [3, 4])
})

test("两条应用新回复已入库但只收到摘要通知时，右侧必须随最新序号补读", async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.conversations[0].type = "app"
  await f.enter()
  await f.messages()
  await f.lists()
  await f.receive(4, ["conversations"])
  await f.receive(5, ["conversations"])
  await f.lists()
  assert.equal(f.data.selected.lastMessageSeq, 5)
  assert.equal(f.messageRequests.length, 1, "左侧最新序号推进时，右侧必须发起消息读取")
  await f.messages()
  await f.lists()
  assert.deepEqual(
    Array.from(f.data.messages, (message: DesktopMessage) => message.seq),
    [1, 2, 3, 4, 5],
  )
  assert.deepEqual(f.readCalls, [3, 5])
})

test("最新序号不变的消息编辑通知仍刷新气泡内容", async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  await f.enter()
  await f.messages()
  await f.lists()
  await f.receive(3, ["messages"])
  assert.equal(f.messageRequests.length, 1)
  const edited = f.data.messages.map((message: DesktopMessage) =>
    message.seq === 3 ? { ...message, content: "已编辑" } : message,
  )
  await f.messages(undefined, edited)
  assert.equal(f.data.messages.at(-1).content, "已编辑")
  assert.deepEqual(f.readCalls, [3])
})

test("消息已加载后再收到同一最新序号的摘要，不重复读取当前窗口", async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  await f.enter()
  await f.messages()
  await f.lists()
  await f.receive(4)
  await f.messages()
  await f.lists()
  assert.equal(f.messageRequests.length, 0)
})

for (const count of [50, 200]) {
  test(`从${count}条历史会话切入时首次读取被打断，不能把旧会话消息合并进新窗口`, async (t) => {
    const f = fixture(false)
    t.after(f.cleanup)
    f.conversations.push({
      ...f.conversations[0],
      id: "first",
      unreadCount: 0,
      lastReadSeq: 1200,
      lastMessageSeq: 1200,
    })
    await f.enter("first")
    const previous = Array.from({ length: count }, (_, index) => ({
      id: `old-${index}`,
      conversationId: "first",
      seq: 1000 + index,
      senderType: "user",
      senderId: "other",
      reactions: [],
      content: `旧会话${index}`,
    })) as unknown as DesktopMessage[]
    await f.messages(undefined, previous)
    assert.equal(f.data.messages.length, count)
    f.data.setSelectedId("room")
    await f.flush()
    await f.receive(4)
    assert.equal(f.messageRequests[1].input.latestLimit, 50)
    await f.messages(0, [])
    await f.messages()
    await f.lists()
    assert.ok(f.data.messages.every((message: DesktopMessage) => message.conversationId === "room"))
    assert.deepEqual(
      Array.from(f.data.messages, (message: DesktopMessage) => message.seq),
      [1, 2, 3, 4],
    )
    assert.deepEqual(f.readCalls, [4])
    assert.equal(f.data.selected.unreadCount, 0)
  })
}

test("首次窗口焦点未就绪不算已读成功，下一帧重检即可清未读，无需再次点击", async (t) => {
  const f = fixture(false)
  t.after(f.cleanup)
  await f.enter()
  f.nativeFocus(false)
  await f.messages()
  assert.deepEqual(f.readAttempts, [3])
  assert.deepEqual(f.readCalls, [])
  f.nativeFocus(true)
  await f.frame()
  await f.lists()
  assert.deepEqual(f.readCalls, [3])
  assert.equal(f.data.selected.unreadCount, 0)
})

test("首次读取期间收到实时消息：取消旧读取后仍按首次加载提交正确消息并清未读", async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  await f.enter()
  await f.receive(4)
  assert.equal(f.messageRequests.length, 2)
  await f.messages(0, [])
  assert.equal(f.readCalls.length, 0)
  await f.messages()
  await f.lists()
  assert.equal(f.data.loadingMessages, false)
  assert.deepEqual(
    Array.from(f.data.messages, (row: DesktopMessage) => row.seq),
    [1, 2, 3, 4],
  )
  assert.deepEqual(f.readCalls, [4])
  assert.equal(f.data.selected.unreadCount, 0)
})
