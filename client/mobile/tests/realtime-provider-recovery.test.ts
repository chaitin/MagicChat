import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import * as jsxRuntime from "react/jsx-runtime"
import ts from "typescript"

import { RealtimeClient, buildRealtimeWebSocketUrl } from "../src/realtime/realtime-client.ts"
import { DISCONNECTED_REALTIME_SNAPSHOT, RealtimeContext, type RealtimeContextValue } from "../src/realtime/realtime-context.ts"
import * as connection from "../src/realtime/realtime-connection.ts"
import { RealtimeDispatcher } from "../src/realtime/realtime-dispatcher.ts"
import { realtimeEvents } from "../src/realtime/realtime-protocol.ts"
import { RealtimeRecovery } from "../src/realtime/realtime-recovery.ts"
import { RealtimeClientSlot } from "../src/realtime/realtime-runtime.ts"

const flush = async () => { for (let index = 0; index < 24; index++) await Promise.resolve() }
const account = (accountId: string) => ({ accountId, generation: accountId === "a" ? 1 : 2, target: { id: "server", url: "https://example.test", userId: accountId } })

function fixture(options: { webOrigin?: string } = {}) {
  let active: ReturnType<typeof account> | null = account("a")
  const states: unknown[] = []
  const refs: { current: unknown }[] = []
  const effects: { deps: unknown[]; cleanup?: () => void; pending?: () => void | (() => void) }[] = []
  let stateIndex = 0, refIndex = 0, effectIndex = 0
  const appListeners = new Set<(state: string) => void>()
  const sockets: MockSocket[] = []
  const synchronizations: { resolve: () => void; reject: (error: Error) => void }[] = []
  let foregroundRequests = 0
  let synchronizationFactories = 0
  const foregroundOptions: { messagesAlreadySynchronizing: boolean }[] = []
  const appliedEvents: { event: string; payload: unknown }[] = []
  const entityEvents: { event: string; payload: unknown }[] = []
  const forgottenEntities: string[] = []
  const queryClient = {}
  const markReauthRequired = () => undefined
  class MockSocket {
    readyState = 0
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    constructor() { sockets.push(this) }
    close() { this.readyState = 3 }
    open() { this.readyState = 1; this.onopen?.() }
    serverClose() { this.readyState = 3; this.onclose?.() }
    ready() { this.onmessage?.({ data: JSON.stringify({ v: 1, kind: "event", event: "system.ready" }) }) }
    event(event: string, payload: unknown) { this.onmessage?.({ data: JSON.stringify({ v: 1, kind: "event", event, payload }) }) }
  }
  const appState = {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appListeners.add(listener)
      return { remove: () => appListeners.delete(listener) }
    },
  }
  const isCurrent = (identity: { accountId: string; generation: number }) => identity.accountId === active?.accountId && identity.generation === active?.generation
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": jsxRuntime,
    react: {
      useState: (initial: unknown) => {
        const index = stateIndex++
        if (index >= states.length) states.push(typeof initial === "function" ? initial() : initial)
        return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next }]
      },
      useRef: (initial: unknown) => { const index = refIndex++; refs[index] ??= { current: initial }; return refs[index] },
      useCallback: (callback: unknown) => callback,
      useMemo: (factory: () => unknown) => factory(),
      useEffect: (pending: () => void | (() => void), deps: unknown[]) => {
        const index = effectIndex++
        const previous = effects[index]
        if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at]))) {
          effects[index] = { deps, cleanup: previous?.cleanup, pending }
        }
      },
    },
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "react-native": { AppState: appState, Platform: { OS: "web" } },
    "@/data/api-client": { isUnauthorizedError: () => false },
    "@/data/auth/account-runtime-instance": { accountAuthRuntime: {
      isCurrent,
      optionsFor: (_target: unknown, accountId: string) => {
        const generation = active!.generation
        return { auth: async () => ({ accountId, generation, token: "test-token" }), isCurrent }
      },
    } },
    "@/data/users/current-user-api": { fetchCurrentUser: async () => ({}) },
    "@/notifications/message-notifications": { prepareMessageNotifications: async () => undefined, showBackgroundMessageNotification: async () => undefined },
    "@/notifications/push-runtime-state": { hasActiveRemotePushDelegation: () => false },
    "@/providers/auth-provider": { useAuth: () => ({ active, isPreparingSignIn: false, markReauthRequired }) },
    "@/realtime/realtime-cache": {
      applyRealtimeEvent: async (_client: unknown, _target: unknown, event: string, payload: unknown) => { appliedEvents.push({ event, payload }); return {} },
      createRealtimeSynchronization: () => {
        synchronizationFactories++
        return () => new Promise<void>((resolve, reject) => { synchronizations.push({ resolve, reject }) })
      },
      refreshClientDataOnForeground: async (_client: unknown, _target: unknown, options: { messagesAlreadySynchronizing: boolean }) => { foregroundRequests++; foregroundOptions.push(options) },
    },
    "@/diagnostics/mobile-startup": { traceMobileStartup: () => undefined },
    "@/realtime/realtime-client": { RealtimeClient, buildRealtimeWebSocketUrl },
    "@/realtime/realtime-connection": connection,
    "@/realtime/realtime-context": { DISCONNECTED_REALTIME_SNAPSHOT, RealtimeContext },
    "@/realtime/realtime-dispatcher": { RealtimeDispatcher },
    "@/realtime/realtime-protocol": { realtimeEvents },
    "@/realtime/realtime-runtime": { RealtimeClientSlot },
    "@/realtime/realtime-recovery": { RealtimeRecovery },
    "@/realtime/entity-sync": { createMobileEntitySync: () => ({
      reconcile: async () => undefined,
      dispose: () => undefined,
      forget: (id: string) => forgottenEntities.push(id),
      notify: (event: string, payload: unknown) => {
        if (!["user.profile.updated", "app.profile.updated", "conversation.updated", "conversation.members.updated"].includes(event)) return false
        entityEvents.push({ event, payload })
        return true
      },
    }) },
    "@/realtime/realtime-payload": { normalizeConversationRemovedPayload: (payload: { conversation_id: string }) => payload.conversation_id },
  }
  const source = readFileSync(new URL("../src/providers/realtime-provider.tsx", import.meta.url), "utf8")
  const code = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: { RealtimeProvider?: (props: unknown) => { props: { value: RealtimeContextValue } } } = {}
  runInNewContext(code, { exports, performance, URL, window: options.webOrigin ? { location: { origin: options.webOrigin } } : undefined, __DEV__: false, WebSocket: MockSocket, require(name: string) {
    if (!(name in dependencies)) throw new Error(`unexpected import ${name}`)
    return dependencies[name]
  } })
  function render() {
    stateIndex = 0; refIndex = 0; effectIndex = 0
    return exports.RealtimeProvider!({ children: "page" }).props.value
  }
  function runEffects() {
    for (const effect of effects) {
      if (!effect.pending) continue
      effect.cleanup?.()
      const pending = effect.pending
      effect.pending = undefined
      effect.cleanup = pending() || undefined
    }
  }
  return {
    render, runEffects, sockets, synchronizations, foregroundOptions, appliedEvents, entityEvents, forgottenEntities,
    synchronizationFactories: () => synchronizationFactories,
    foregroundRequests: () => foregroundRequests,
    switchAccount: (next: ReturnType<typeof account> | null) => { active = next },
    appState: (state: string) => { appState.currentState = state; for (const listener of appListeners) listener(state) },
    dispose: () => { for (const effect of effects) effect.cleanup?.() },
  }
}

test("实体事件走独立同步器，离群立即废弃进行中的实体请求", async (t) => {
  const f = fixture()
  t.after(f.dispose)
  f.render(); f.runEffects()
  await flush()
  f.sockets[0]!.open(); f.sockets[0]!.ready()
  await flush()
  f.synchronizations[0]!.resolve()
  await flush()
  f.sockets[0]!.event("conversation.members.updated", { conversation_id: "group-1", revision: 2 })
  f.sockets[0]!.event("conversation.removed", { conversation_id: "group-1" })
  await flush()
  assert.equal(f.entityEvents[0]?.event, "conversation.members.updated")
  assert.deepEqual(f.forgottenEntities, ["group-1"])
  assert.equal(f.appliedEvents.some((item) => item.event === "conversation.members.updated"), false)
})

test("Provider在首个effect之前就展示连接态，Socket握手不能提前恢复标题", async (t) => {
  const f = fixture()
  t.after(f.dispose)
  assert.equal(f.render().isRecovering, true)
  f.runEffects()
  await flush()
  f.sockets[0]!.open()
  assert.equal(f.render().isRecovering, true)
  f.sockets[0]!.ready()
  await flush()
  assert.equal(f.render().ready, true)
  assert.equal(f.render().isRecovering, true)
  assert.equal(f.synchronizations.length, 1)
  f.synchronizations[0]!.resolve()
  await flush()
  assert.equal(f.render().isRecovering, false)
})

test("健康连接从后台回前台只刷新数据，不重新显示连接标题", async (t) => {
  const f = fixture()
  t.after(f.dispose)
  f.render(); f.runEffects(); await flush()
  f.sockets[0]!.open(); f.sockets[0]!.ready(); await flush()
  f.synchronizations[0]!.resolve(); await flush()
  assert.equal(f.render().isRecovering, false)
  f.appState("background"); f.appState("active")
  assert.equal(f.render().isRecovering, false)
  await flush()
  assert.equal(f.render().isRecovering, false)
  assert.equal(f.foregroundRequests(), 1)
  assert.equal(f.foregroundOptions[0]?.messagesAlreadySynchronizing, false)
  assert.equal(f.synchronizations.length, 1)
  assert.equal(f.sockets.length, 1)
})

test("真实Socket断开后保持连接标题，新握手及其同步完成才能恢复", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture()
  t.after(f.dispose)
  f.render(); f.runEffects(); await flush()
  f.sockets[0]!.open(); f.sockets[0]!.ready(); await flush()
  f.synchronizations[0]!.resolve(); await flush()
  assert.equal(f.render().isRecovering, false)
  f.sockets[0]!.serverClose()
  assert.equal(f.render().isRecovering, true)
  await flush()
  t.mock.timers.tick(1_000); await flush()
  assert.equal(f.sockets.length, 2)
  f.sockets[1]!.open(); f.sockets[1]!.ready(); await flush()
  assert.equal(f.synchronizationFactories(), 2)
  assert.equal(f.render().isRecovering, true)
  f.synchronizations[1]!.resolve(); await flush()
  assert.equal(f.render().isRecovering, false)
})

test("握手后HTTP同步失败会重试同步，但不会额外重建Socket", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture()
  t.after(f.dispose)
  f.render(); f.runEffects(); await flush()
  f.sockets[0]!.open(); f.sockets[0]!.ready(); await flush()
  f.synchronizations[0]!.reject(new Error("offline")); await flush()
  assert.equal(f.render().isRecovering, true)
  t.mock.timers.tick(1_000); await flush()
  assert.equal(f.sockets.length, 1)
  assert.equal(f.synchronizations.length, 2)
  assert.equal(f.synchronizationFactories(), 1)
  f.synchronizations[1]!.resolve(); await flush()
  assert.equal(f.render().isRecovering, false)
})

test("切换账号立即进入新连接态，旧结果无效；退出登录立即恢复普通标题", async (t) => {
  const f = fixture()
  t.after(f.dispose)
  f.render(); f.runEffects(); await flush()
  f.sockets[0]!.open(); f.sockets[0]!.ready(); await flush()
  f.switchAccount(account("b"))
  assert.equal(f.render().isRecovering, true)
  f.runEffects(); await flush()
  f.synchronizations[0]!.resolve(); await flush()
  assert.equal(f.render().isRecovering, true)
  f.sockets[1]!.open(); f.sockets[1]!.ready(); await flush()
  f.synchronizations[1]!.resolve(); await flush()
  assert.equal(f.render().isRecovering, false)
  f.switchAccount(null)
  assert.equal(f.render().isRecovering, false)
  f.runEffects()
})

test("恢复尚未完成时回前台不启动第二轮消息同步，也不堵住辅助刷新", async (t) => {
  const f = fixture()
  t.after(f.dispose)
  f.render(); f.runEffects(); await flush()
  f.sockets[0]!.open(); f.sockets[0]!.ready(); await flush()
  f.appState("background"); f.appState("active")
  await flush()
  assert.equal(f.foregroundRequests(), 1)
  assert.equal(f.foregroundOptions[0]?.messagesAlreadySynchronizing, true)
  assert.equal(f.synchronizations.length, 1)
  assert.equal(f.render().isRecovering, true)
  f.synchronizations[0]!.resolve(); await flush()
  assert.equal(f.render().isRecovering, false)
})

test("第30个之后会话的实时新消息和状态事件仍正常分发", async (t) => {
  const f = fixture()
  t.after(f.dispose)
  f.render(); f.runEffects(); await flush()
  f.sockets[0]!.open(); f.sockets[0]!.ready(); await flush()
  f.synchronizations[0]!.resolve(); await flush()
  const payload = { conversation_id: "conversation-54", message_id: "new-message" }
  f.sockets[0]!.event(realtimeEvents.messageCreated, payload)
  f.sockets[0]!.event(realtimeEvents.messageReactionsUpdated, payload)
  await flush()
  assert.deepEqual(f.appliedEvents.map((item) => item.event), [realtimeEvents.messageCreated, realtimeEvents.messageReactionsUpdated])
  assert.ok(f.appliedEvents.every((item) => (item.payload as typeof payload).conversation_id === "conversation-54"))
})

test("浏览器不支持当前服务器的WebSocket时仍立即执行有限HTTP同步", async (t) => {
  const f = fixture({ webOrigin: "https://mobile.example.test" })
  t.after(f.dispose)
  assert.equal(f.render().isRecovering, false)
  f.runEffects(); await flush()
  assert.equal(f.sockets.length, 0)
  assert.equal(f.synchronizations.length, 1)
  f.synchronizations[0]!.resolve(); await flush()
})
