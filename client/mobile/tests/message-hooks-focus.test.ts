import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

const target = { id: "server", url: "https://example.test", userId: "user" }
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }

function fixture() {
  const effects: { deps: unknown[]; cleanup?: () => void; pending?: () => void | (() => void) }[] = []
  const memos: { deps: unknown[]; value: unknown }[] = []
  const states: unknown[] = []
  let effectIndex = 0, memoIndex = 0, stateIndex = 0
  const timers = new Set<() => void>()
  const calls = { latest: [] as { server: typeof target; id: string; limit: number }[], hydrated: [] as string[], compacted: [] as string[] }
  const page = { messages: [], page: { hasMoreAfter: false, hasMoreBefore: false, limit: 20, newestSeq: 0, oldestSeq: 0 } }
  const memo = (factory: () => unknown, deps: unknown[]) => {
    const index = memoIndex++
    if (!memos[index] || deps.some((value, at) => !Object.is(value, memos[index]!.deps[at]))) memos[index] = { deps, value: factory() }
    return memos[index]!.value
  }
  const queryClient = {}
  const dependencies: Record<string, unknown> = {
    react: {
      useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps), useMemo: memo,
      useState: (initial: unknown) => {
        const index = stateIndex++
        if (index >= states.length) states.push(initial)
        return [states[index], (next: unknown) => { states[index] = next }]
      },
      useEffect: (pending: () => void | (() => void), deps: unknown[]) => {
        const index = effectIndex++, previous = effects[index]
        if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at]))) effects[index] = { deps, cleanup: previous?.cleanup, pending }
      },
    },
    "@tanstack/react-query": {
      useQueryClient: () => queryClient,
      useInfiniteQuery: () => ({ data: { pages: [page], pageParams: [null] }, error: null, isLoading: false }),
    },
    "@/data/conversations/index": {},
    "@/data/messages": {
      messageManager: { synchronizeLatest: async (server: typeof target, id: string, limit: number) => { calls.latest.push({ server, id, limit }); return page } },
      subscribeConversationMessages: () => () => undefined,
    },
    "@/data/messages/message-query-cache": {
      hydrateConversationMessagesQuery: async (_client: unknown, _server: unknown, id: string) => { calls.hydrated.push(id) },
      compactConversationMessagesQuery: (_client: unknown, _server: unknown, id: string) => { calls.compacted.push(id) },
    },
    "@/data/query": { queryKeys: { conversationMessages: (_target: unknown, id: string) => ["conversation", id, "messages"] } },
    "@/data/query/fallback-polling": { FALLBACK_POLLING_INTERVAL_MS: 15_000 },
    "@/diagnostics/mobile-perf": { recordMobilePerf: () => undefined },
    "@/domain/messages/message-presenter": {}, "@/domain/messages/message-reactions": {},
  }
  const code = ts.transpileModule(readFileSync(new URL("../src/data/messages/message-hooks.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: { useConversationMessages?: (server: typeof target, id: string, options: unknown) => unknown } = {}
  runInNewContext(code, {
    exports, performance,
    setInterval: (callback: () => void) => { timers.add(callback); return callback },
    clearInterval: (callback: () => void) => timers.delete(callback),
    require(name: string) { if (!(name in dependencies)) throw new Error(`unexpected import ${name}`); return dependencies[name] },
  })
  function render(live: boolean, fallbackPollingEnabled = false, server = target) {
    effectIndex = 0; memoIndex = 0; stateIndex = 0
    exports.useConversationMessages!(server, "conversation-40", { live, fallbackPollingEnabled })
    for (const effect of effects) {
      if (!effect.pending) continue
      effect.cleanup?.()
      const pending = effect.pending
      effect.pending = undefined
      effect.cleanup = pending() || undefined
    }
  }
  return { render, calls, timers, dispose: () => { for (const effect of effects) effect.cleanup?.() } }
}

test("第40个聊天进入页面时按需刷新最新20条，未打开时不拉消息", async (t) => {
  const f = fixture()
  t.after(f.dispose)
  f.render(false)
  await flush()
  assert.deepEqual(f.calls.latest, [])
  f.render(true)
  await flush()
  assert.deepEqual(f.calls.latest, [{ server: target, id: "conversation-40", limit: 20 }])
  assert.deepEqual(f.calls.hydrated, ["conversation-40"])
})

test("隐藏但仍挂载的聊天页不轮询，离开时清理当前页定时器", async (t) => {
  const f = fixture()
  t.after(f.dispose)
  f.render(false, true)
  assert.equal(f.timers.size, 0)
  f.render(true, true)
  await flush()
  assert.equal(f.timers.size, 1)
  f.render(false, true)
  await flush()
  assert.equal(f.timers.size, 0)
  assert.equal(f.calls.latest.length, 1)
  assert.deepEqual(f.calls.compacted, ["conversation-40"])
})

test("已经打开的聊天在重连就绪后仍刷新最新一页，覆盖自动补拉之外的大缺口", async (t) => {
  const f = fixture()
  t.after(f.dispose)
  f.render(true, true)
  await flush()
  f.render(true, false)
  await flush()
  assert.equal(f.calls.latest.length, 2)
  assert.ok(f.calls.latest.every((call) => call.id === "conversation-40" && call.limit === 20))
  assert.equal(f.timers.size, 0)
})

test("按需刷新使用当前不可变账号目标，切换账号不沿用旧请求目标", async (t) => {
  const f = fixture()
  t.after(f.dispose)
  f.render(true)
  const other = { ...target, userId: "other" }
  f.render(true, false, other)
  await flush()
  assert.deepEqual(f.calls.latest.map((call) => call.server.userId), ["user", "other"])
})

test("聊天页面把真实焦点状态传给消息订阅，而不是所有挂载页面都保持live", () => {
  const source = readFileSync(new URL("../src/features/conversation/conversation-screen.tsx", import.meta.url), "utf8")
  assert.match(source, /useConversationMessages\(session, conversationId, \{\s*live: isFocused,/)
})
