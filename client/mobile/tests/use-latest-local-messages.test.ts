import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

import type { ClientConversation, ClientMessage } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"

type PreviewResult = { latestMessages: ReadonlyMap<string, ClientMessage>; isLoading: boolean }
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"]
  let reject!: Deferred<T>["reject"]
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const target = { id: "server", url: "https://example.test", userId: "user-a" }
const conversations = [{ id: "c1" }] as ClientConversation[]
const message = { id: "m1", seq: 1 } as ClientMessage
const source = readFileSync(new URL("../src/features/messages/use-latest-local-messages.ts", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

// Run the actual hook with deterministic hook slots and mocked I/O, without a native renderer.
function createHarness() {
  const slots: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = []
  let cursor = 0
  let stateUpdates = 0
  let effects: (() => void)[] = []
  const batches: Deferred<Map<string, ClientMessage>>[] = []
  const pages: Deferred<{ messages: ClientMessage[] }>[] = []
  const changes = new Set<(id: string, event: { type: "upsert" | "clear" }) => void>()
  const clears = new Set<() => void>()
  const changed = (previous: unknown[] | undefined, deps: unknown[]) => !previous || previous.length !== deps.length || deps.some((value, index) => !Object.is(value, previous[index]))
  const react = {
    useMemo<T>(factory: () => T, deps: unknown[]) {
      const index = cursor++
      if (changed(slots[index]?.deps, deps)) slots[index] = { value: factory(), deps }
      return slots[index].value as T
    },
    useState<T>(initial: T) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: initial }
      return [slots[index].value as T, (next: T | ((current: T) => T)) => {
        stateUpdates += 1
        slots[index].value = typeof next === "function" ? (next as (current: T) => T)(slots[index].value as T) : next
      }]
    },
    useEffect(effect: () => () => void, deps: unknown[]) {
      const index = cursor++
      if (!changed(slots[index]?.deps, deps)) return
      effects.push(() => {
        slots[index]?.cleanup?.()
        slots[index] = { deps, cleanup: effect() }
      })
    },
  }
  const exports = {} as { useLatestLocalMessages: (session: AuthenticatedTarget, items: ClientConversation[]) => PreviewResult }
  runInNewContext(compiled, {
    exports,
    performance,
    require(specifier: string) {
      if (specifier === "react") return react
      if (specifier === "@/diagnostics/mobile-startup") return { traceMobileStartup() {} }
      if (specifier === "@/data/messages") return { messageManager: {
        readLatestLocalPreviews() { const batch = deferred<Map<string, ClientMessage>>(); batches.push(batch); return batch.promise },
        readLatestPage() { const page = deferred<{ messages: ClientMessage[] }>(); pages.push(page); return page.promise },
      } }
      if (specifier === "@/data/messages/message-events") return {
        subscribeMessageChanges(_session: AuthenticatedTarget, listener: (id: string, event: { type: "upsert" | "clear" }) => void) { changes.add(listener); return () => changes.delete(listener) },
        subscribeAllMessageCacheCleared(listener: () => void) { clears.add(listener); return () => clears.delete(listener) },
      }
      throw new Error(`Unexpected import: ${specifier}`)
    },
  })
  return {
    batches,
    pages,
    render(session = target, items = conversations) {
      cursor = 0
      effects = []
      const result = exports.useLatestLocalMessages(session, items)
      effects.forEach((effect) => effect())
      return result
    },
    change(type: "upsert" | "clear") { changes.forEach((listener) => listener("c1", { type })) },
    clear() { clears.forEach((listener) => listener()) },
    unmount() { slots.forEach((slot) => slot.cleanup?.()) },
    updates() { return stateUpdates },
  }
}

test("首批本地预览返回前保持加载态，成功后显示真实缓存", async () => {
  const hook = createHarness()
  assert.equal(hook.render().isLoading, true)
  hook.batches[0].resolve(new Map([["c1", message]]))
  await flush()
  const result = hook.render()
  assert.equal(result.isLoading, false)
  assert.equal(result.latestMessages.get("c1"), message)
})

test("先收到空会话集合不会提前放行后续首批读取，无消息缓存也正常结束加载", async () => {
  const hook = createHarness()
  assert.equal(hook.render(target, []).isLoading, false)
  hook.batches[0].resolve(new Map())
  await flush()
  assert.equal(hook.render().isLoading, true)
  hook.batches[1].resolve(new Map())
  await flush()
  assert.equal(hook.render().isLoading, false)
})

test("会话集合刷新不隐藏已就绪的列表", async () => {
  const hook = createHarness()
  hook.render()
  hook.batches[0].resolve(new Map([["c1", message]]))
  await flush()
  const result = hook.render(target, [...conversations, { id: "c2" } as ClientConversation])
  assert.equal(result.isLoading, false)
  assert.equal(result.latestMessages.get("c1"), message)
  assert.equal(hook.batches.length, 2)
})

test("读取失败结束加载，不让列表永久停留在加载态", async () => {
  const hook = createHarness()
  hook.render()
  hook.batches[0].reject(new Error("database unavailable"))
  await flush()
  assert.equal(hook.render().isLoading, false)
})

test("切换账号隐藏旧预览，旧读取失败不能放行新账号", async () => {
  const hook = createHarness()
  hook.render()
  hook.batches[0].resolve(new Map([["c1", message]]))
  await flush()
  const other = { ...target, userId: "user-b" }
  const result = hook.render(other)
  assert.equal(result.isLoading, true)
  assert.equal(result.latestMessages.size, 0)
  const next = { ...target, userId: "user-c" }
  hook.render(next)
  hook.batches[1].reject(new Error("stale account read"))
  await flush()
  assert.equal(hook.render(next).isLoading, true)
  assert.equal(hook.render(next).latestMessages.size, 0)
  hook.batches[2].resolve(new Map())
  await flush()
  assert.equal(hook.render(next).isLoading, false)
})

test("旧账号读取迟到失败不覆盖已就绪的新账号", async () => {
  const hook = createHarness()
  hook.render()
  const other = { ...target, userId: "user-b" }
  hook.render(other)
  const newer = { ...message, id: "other-message" }
  hook.batches[1].resolve(new Map([["c1", newer]]))
  await flush()
  assert.equal(hook.render(other).isLoading, false)
  hook.batches[0].reject(new Error("late previous account failure"))
  await flush()
  const result = hook.render(other)
  assert.equal(result.isLoading, false)
  assert.equal(result.latestMessages.get("c1"), newer)
})

test("加载期间清空缓存立即结束加载，并丢弃清空前的结果", async () => {
  const hook = createHarness()
  hook.render()
  hook.clear()
  assert.equal(hook.render().isLoading, false)
  hook.batches[0].resolve(new Map([["c1", message]]))
  await flush()
  assert.equal(hook.render().latestMessages.size, 0)
})

test("首批读取期间的新消息不会被旧预览覆盖，单会话清理保持列表就绪", async () => {
  const hook = createHarness()
  hook.render()
  hook.change("upsert")
  const updated = { ...message, seq: 2 }
  hook.pages[0].resolve({ messages: [updated] })
  await flush()
  assert.equal(hook.render().isLoading, true)
  hook.batches[0].resolve(new Map([["c1", message]]))
  await flush()
  assert.equal(hook.render().latestMessages.get("c1"), updated)
  hook.change("clear")
  const cleared = hook.render()
  assert.equal(cleared.isLoading, false)
  assert.equal(cleared.latestMessages.size, 0)
})

test("完整列表先等待预览、分批挂载，并在加载期间推迟未读跳转", () => {
  const list = readFileSync(new URL("../src/features/messages/conversation-list.tsx", import.meta.url), "utf8")
  const screen = readFileSync(new URL("../src/features/messages/messages-screen.tsx", import.meta.url), "utf8")
  assert.match(list, /data=\{isLoading \? \[\] : items\}/)
  assert.match(list, /maxToRenderPerBatch=\{4\}/)
  assert.match(list, /windowSize=\{5\}/)
  assert.match(list, /<ContentState loading=\{isLoading\}/)
  assert.match(list, /!isLoading && items\.length > 0/)
  assert.match(list, /if \(isLoading \|\| scrollToUnreadRequest === 0/)
  assert.match(list, /\[isLoading, latestUnreadIndex, scrollToUnreadRequest\]/)
  assert.match(list, /<ConversationAvatar/)
  assert.match(list, /<ReanimatedSwipeable/)
  assert.match(screen, /isLoading=\{isPreviewLoading\}/)
})

test("卸载后迟到的读取结果不再更新状态", async () => {
  const hook = createHarness()
  hook.render()
  hook.unmount()
  hook.batches[0].reject(new Error("late failure"))
  await flush()
  assert.equal(hook.updates(), 0)
})
