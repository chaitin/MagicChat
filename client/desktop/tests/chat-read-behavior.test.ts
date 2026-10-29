import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import type { DesktopConversation, DesktopMessage } from "../src/shared/account-data.ts"

const hooks = "../src/renderer/features/chat/hooks/use-chat-data.ts"
const ipc = "../src/main/ipc/register-account-data-ipc.ts"
type OpenReadIntent = { targetId: string; conversationId: string } | null

function callback(file: string, name: string, scope: Record<string, unknown>): Function {
  const source = ts.createSourceFile(
    file,
    readFileSync(new URL(file, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  )
  let text = ""
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      text = node.initializer.arguments[0].getText(source)
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect") {
      const body = node.arguments[0]?.getText(source) ?? ""
      if (
        (name === "read" && body.includes(".markConversationRead(")) ||
        (name === "focus" && body.includes('addEventListener("visibilitychange"'))
      )
        text = body
    }
    if (
      name === "ipcRead" &&
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "handle" &&
      node.arguments[0]?.getText(source) === "ACCOUNT_DATA_CHANNELS.markConversationRead"
    ) {
      text = node.arguments[1].getText(source)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(text, `未找到回调 ${name}`)
  const compiled = ts.transpileModule(`const callback = ${text}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  return new Function(...Object.keys(scope), `${compiled}\nreturn callback;`)(
    ...Object.values(scope),
  )
}

const message = (conversationId: string, seq: number, extra = {}) =>
  ({ conversationId, seq, ...extra }) as DesktopMessage
const room = (id: string) =>
  ({
    id,
    type: "group",
    unreadCount: 3,
    lastReadSeq: 97,
    lastMessageSeq: 105,
  }) as DesktopConversation

function fixture(focused = false) {
  const calls: Array<{ targetId: string; conversationId: string; upToSeq: number }> = []
  let nativeFocused = true
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    hasFocus: () => focused,
  })
  const submitRead = callback(ipc, "ipcRead", {
    getMainWindow: () => ({
      isDestroyed: () => false,
      isFocused: () => nativeFocused,
      isVisible: () => document.visibilityState === "visible",
      isMinimized: () => false,
    }),
    auth: {
      markConversationRead: async (input: (typeof calls)[number]) => {
        calls.push(input)
        return null
      },
    },
  })
  const window = Object.assign(new EventTarget(), {
    desktop: {
      accountData: {
        markConversationRead: async (input: (typeof calls)[number]) => {
          await submitRead(input)
          return { ok: true }
        },
      },
    },
  })
  const scope = {
    window,
    document,
    targetId: "account",
    activeSection: "chat",
    loadingMessages: false,
    conversations: [room("room"), room("other")],
    selectedId: "room" as string | null,
    selected: room("room") as DesktopConversation | null,
    messages: [message("room", 98), message("room", 99), message("room", 100)],
    selectedIdRef: { current: "room" as string | null },
    loadedConversationIdRef: { current: "room" as string | null },
    openReadIntent: null as OpenReadIntent,
    setOpenReadIntent: (value: OpenReadIntent | ((current: OpenReadIntent) => OpenReadIntent)) => {
      scope.openReadIntent = typeof value === "function" ? value(scope.openReadIntent) : value
    },
    readInFlightRef: { current: new Set<string>() },
    shouldReloadConversationListForSelection: () => false,
    setTransientConversation: () => {},
    setConversationRevision: () => {},
    setFocusRevision: () => {},
    setSelectedIdState: (id: string | null) => {
      scope.selectedId = id
      scope.selectedIdRef.current = id
      scope.selected = scope.conversations.find((item) => item.id === id) ?? null
    },
  }
  const cleanup = callback(hooks, "focus", scope)() as () => void
  return {
    scope,
    calls,
    cleanup,
    select: (id: string | null = "room") => callback(hooks, "setSelectedId", scope)(id),
    read: () => callback(hooks, "read", scope)(),
    focus: () => {
      nativeFocused = true
      focused = true
      window.dispatchEvent(new Event("focus"))
    },
    blur: () => {
      nativeFocused = false
      focused = false
      window.dispatchEvent(new Event("blur"))
    },
    hide: () => {
      document.visibilityState = "hidden"
      document.dispatchEvent(new Event("visibilitychange"))
    },
  }
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

test("主动进入会话后不受瞬时文档焦点影响，只标记已展示序号而非服务端最新序号", async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.select()
  f.scope.messages.push(
    message("other", 999),
    message("room", 110, { virtualType: "topic_source" }),
    message("room", 111, { deliveryStatus: "sending" }),
    message("room", 112, { deliveryStatus: "failed" }),
  )
  f.read()
  await flush()
  assert.deepEqual(f.calls, [{ targetId: "account", conversationId: "room", upToSeq: 100 }])
})

test("窗口仍在前台时，文档的瞬时blur不会取消主动进入的阅读意图", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.select()
  f.scope.window.dispatchEvent(new Event("blur"))
  f.read()
  assert.equal(f.calls.length, 1)
})

test("主动进入等到对应会话加载完成，不读取上一会话残留的消息", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.select("other")
  f.read()
  assert.equal(f.calls.length, 0)
  f.scope.loadedConversationIdRef.current = "other"
  f.scope.loadingMessages = true
  f.read()
  assert.equal(f.calls.length, 0)
  f.scope.messages = [message("other", 100)]
  f.scope.loadingMessages = false
  f.read()
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].conversationId, "other")
})

test("快速切换会话后旧消息不能清除原会话或新会话未读", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.select("room")
  f.select("other")
  f.scope.messages = [message("room", 100)]
  f.scope.loadedConversationIdRef.current = "other"
  f.read()
  assert.equal(f.calls.length, 0)
})

test("旧渲染的已读Effect不能清掉后来点击的新会话阅读意图", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.select("room")
  const staleRead = callback(hooks, "read", f.scope)
  f.select("other")
  staleRead()
  assert.equal(f.scope.openReadIntent?.conversationId, "other")
  f.scope.loadedConversationIdRef.current = "other"
  f.scope.messages = [message("other", 100)]
  f.read()
  assert.equal(f.calls.at(-1)?.conversationId, "other")
})

test("主动进入资格只用于首次展示，后续未聚焦的新消息仍保留未读", async (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.select()
  f.read()
  await flush()
  f.scope.selected!.lastReadSeq = 100
  f.scope.messages.push(message("room", 101))
  f.read()
  assert.equal(f.calls.length, 1)
  f.focus()
  f.read()
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[1].upToSeq, 101)
})

test("进入时本来无未读或没有有效消息，也不把主动阅读资格留给后续消息", (t) => {
  for (const empty of [false, true]) {
    const f = fixture()
    t.after(f.cleanup)
    f.select()
    f.scope.selected!.unreadCount = 0
    f.scope.selected!.lastReadSeq = 100
    if (empty) f.scope.messages = []
    f.read()
    assert.equal(f.calls.length, 0)
    f.scope.selected!.unreadCount = 1
    f.scope.messages = [message("room", 101)]
    f.read()
    assert.equal(f.calls.length, 0)
  }
})

test("初始未读快照尚未更新时，主动进入仍以已展示消息推进已读", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.select()
  f.scope.selected!.unreadCount = 0
  f.read()
  assert.equal(f.calls.length, 1)
})

for (const leave of ["blur", "hide", "section"] as const) {
  test(`主动进入后加载期间发生${leave}，不在后台消除未读`, (t) => {
    const f = fixture()
    t.after(f.cleanup)
    f.select()
    f.scope.loadingMessages = true
    if (leave === "blur") f.blur()
    else if (leave === "hide") f.hide()
    else {
      f.scope.activeSection = "contacts"
      f.read()
      f.scope.activeSection = "chat"
    }
    f.scope.loadingMessages = false
    f.read()
    assert.equal(f.calls.length, 0)
    f.scope.document.visibilityState = "visible"
    f.read()
    assert.equal(f.calls.length, 0)
  })
}

test("未主动进入时仍要求文档聚焦与页面可见", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.read()
  assert.equal(f.calls.length, 0)
  f.focus()
  f.scope.document.visibilityState = "hidden"
  f.read()
  assert.equal(f.calls.length, 0)
  f.scope.document.visibilityState = "visible"
  f.read()
  assert.equal(f.calls.length, 1)
})

test("已有已读请求期间保留主动进入资格，完成后再推进本次展示的序号", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.select()
  f.scope.readInFlightRef.current.add("account:room")
  f.read()
  assert.equal(f.calls.length, 0)
  assert.ok(f.scope.openReadIntent)
  f.scope.readInFlightRef.current.delete("account:room")
  f.read()
  assert.equal(f.calls.length, 1)
})

test("即使文档焦点值滞后仍为true，原生窗口已退到后台也不自动已读", (t) => {
  const f = fixture(true)
  t.after(f.cleanup)
  f.blur()
  f.scope.document.hasFocus = () => true
  f.read()
  assert.equal(f.calls.length, 0)
})

test("未参与话题不会因主动打开而清除未读", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.scope.conversations[0] = {
    ...room("room"),
    type: "topic",
    topic: { participating: false },
  } as DesktopConversation
  f.select()
  f.read()
  assert.equal(f.calls.length, 0)
})

test("跨账号不会沿用上一次的主动进入资格", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.select()
  f.scope.targetId = "another-account"
  f.read()
  assert.equal(f.calls.length, 0)
})

for (const state of [
  "focused",
  "background",
  "hidden",
  "minimized",
  "destroyed",
  "missing",
] as const) {
  test(`主进程以真实窗口状态${state}兜底，后台或不可见窗口不提交已读`, async () => {
    const calls: unknown[] = []
    const input = { targetId: "account", conversationId: "room", upToSeq: 100 }
    const operation = callback(ipc, "ipcRead", {
      getMainWindow: () =>
        state === "missing"
          ? null
          : {
              isDestroyed: () => state === "destroyed",
              isFocused: () => state !== "background",
              isVisible: () => state !== "hidden",
              isMinimized: () => state === "minimized",
            },
      auth: {
        markConversationRead: async (value: unknown) => {
          calls.push(value)
          return null
        },
      },
    })
    await operation(input)
    assert.deepEqual(calls, state === "focused" ? [input] : [])
  })
}
