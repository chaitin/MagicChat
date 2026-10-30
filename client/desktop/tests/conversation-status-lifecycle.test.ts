import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import type { ConversationPresenceEvent, DesktopConversation } from "../src/shared/account-data.ts"
import { parseConversationPresenceEvent } from "../src/main/account/conversation-presence.ts"
import * as policy from "../src/renderer/features/chat/conversation-status-policy.ts"

type Slot = { value?: any; deps?: unknown[]; cleanup?: () => void }
function fixture(type: DesktopConversation["type"] = "app") {
  const slots: Slot[] = []
  let cursor = 0
  let dirty = false
  let effects: Array<() => void> = []
  let status: string | undefined
  let timerId = 0
  const timers = new Map<number, { callback: () => void; delay: number }>()
  const intervals = new Map<number, () => void>()
  const presence = new Set<(event: ConversationPresenceEvent) => void>()
  const sync = new Set<(event: { targetId: string; state: string }) => void>()
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" })
  const sent: unknown[] = []
  const props = {
    targetId: "account",
    conversation: { id: "room", type } as DesktopConversation | null,
    draft: "",
    focused: false,
  }
  const changed = (left?: unknown[], right?: unknown[]) =>
    !left ||
    !right ||
    left.length !== right.length ||
    right.some((value, index) => !Object.is(value, left[index]))
  function memo(factory: () => unknown, deps: unknown[]) {
    const slot = (slots[cursor++] ??= {})
    if (changed(slot.deps, deps)) {
      slot.value = factory()
      slot.deps = deps
    }
    return slot.value
  }
  const react = {
    useState(initial: unknown) {
      const slot = (slots[cursor++] ??= {
        value: typeof initial === "function" ? initial() : initial,
      })
      return [
        slot.value,
        (next: unknown) => {
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
    useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
    useEffect(callback: () => (() => void) | undefined, deps: unknown[]) {
      const slot = (slots[cursor++] ??= {})
      if (changed(slot.deps, deps)) {
        slot.deps = deps
        effects.push(() => {
          slot.cleanup?.()
          slot.cleanup = callback()
        })
      }
    },
  }
  const window = {
    setTimeout(callback: () => void, delay: number) {
      const id = ++timerId
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval(callback: () => void) {
      const id = ++timerId
      intervals.set(id, callback)
      return id
    },
    clearInterval: (id: number) => intervals.delete(id),
    desktop: {
      accountData: {
        onConversationPresenceChanged(callback: (event: ConversationPresenceEvent) => void) {
          presence.add(callback)
          return () => presence.delete(callback)
        },
        onSyncStateChange(callback: (event: { targetId: string; state: string }) => void) {
          sync.add(callback)
          return () => sync.delete(callback)
        },
        sendConversationStatus: async (input: unknown) => {
          sent.push(input)
        },
      },
    },
  }
  const module = {
    exports: {} as { useConversationStatus: (input: typeof props) => string | undefined },
  }
  const source = readFileSync(
    new URL("../src/renderer/features/chat/hooks/use-conversation-status.ts", import.meta.url),
    "utf8",
  )
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports: module.exports,
      module,
      window,
      document,
      require: (name: string) => (name === "react" ? react : policy),
    },
  )
  function render() {
    for (let pass = 0; pass < 10; pass++) {
      dirty = false
      cursor = 0
      status = module.exports.useConversationStatus(props)
      const jobs = effects
      effects = []
      jobs.forEach((job) => job())
      if (!dirty) return
    }
    throw new Error("Header状态Hook未稳定")
  }
  render()
  return {
    props,
    sent,
    timers,
    intervals,
    get status() {
      return status
    },
    render,
    state(state: string) {
      sync.forEach((callback) => callback({ targetId: props.targetId, state }))
      render()
    },
    event(
      name: "conversation.status" | "message.created",
      sender = { id: "app", type: "app" },
      conversationId = "room",
      targetId = "account",
    ) {
      const payload =
        name === "conversation.status"
          ? {
              conversation_id: conversationId,
              status: sender.type === "user" ? "正在输入" : "正在运行",
              sender,
            }
          : { message: { conversation_id: conversationId, sender } }
      const event = parseConversationPresenceEvent(targetId, name, payload)
      assert.ok(event)
      presence.forEach((callback) => callback(event))
      render()
    },
    expire() {
      const jobs = [...timers.values()]
      timers.clear()
      jobs.forEach(({ callback }) => callback())
      render()
    },
    cleanup() {
      slots.forEach((slot) => slot.cleanup?.())
    },
  }
}

test("应用状态事件到达后交给Header展示，回复到达时清除", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.event("conversation.status")
  assert.equal(f.status, "正在运行")
  f.event("message.created", { id: "me", type: "user" })
  assert.equal(f.status, "正在运行", "自己的消息不能清掉应用运行状态")
  f.event("message.created")
  assert.equal(f.status, undefined)
})

test("重连期间先收到缓存状态、随后ready时，Header立即恢复第二行状态", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.state("loading")
  f.event("conversation.status")
  assert.equal(f.status, undefined)
  f.state("ready")
  assert.equal(f.status, "正在运行", "恢复连接不能继续复用loading时缓存的空状态")
})

test("单聊输入状态经过同一解析与订阅链路展示", (t) => {
  const f = fixture("direct")
  t.after(f.cleanup)
  f.event("conversation.status", { id: "other", type: "user" })
  assert.equal(f.status, "正在输入")
})

test("状态心跳刷新过期时间，过期后清除Header状态", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.event("conversation.status")
  f.event("conversation.status")
  assert.equal(f.timers.size, 1)
  assert.equal([...f.timers.values()][0].delay, policy.CONVERSATION_STATUS_TTL_MS)
  f.expire()
  assert.equal(f.status, undefined)
})

test("其他会话或账号的状态不会出现在当前Header", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.event("conversation.status", undefined, "other")
  f.event("conversation.status", undefined, "room", "other-account")
  assert.equal(f.status, undefined)
  f.event("conversation.status")
  assert.equal(f.status, "正在运行")
  f.props.targetId = "other-account"
  f.render()
  assert.equal(f.status, undefined)
})

test("非单聊和应用会话不错误展示输入状态", (t) => {
  const f = fixture("group")
  t.after(f.cleanup)
  f.event("conversation.status")
  assert.equal(f.status, undefined)
})

test("输入心跳在断线时停止，重连后恢复，卸载清理订阅与计时器", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.props.draft = "hello"
  f.props.focused = true
  f.render()
  assert.equal(f.sent.length, 1)
  assert.equal(f.intervals.size, 1)
  f.state("loading")
  assert.equal(f.intervals.size, 0)
  f.state("ready")
  assert.equal(f.sent.length, 2)
  assert.equal(f.intervals.size, 1)
  f.event("conversation.status")
  f.cleanup()
  assert.equal(f.timers.size, 0)
  assert.equal(f.intervals.size, 0)
})
