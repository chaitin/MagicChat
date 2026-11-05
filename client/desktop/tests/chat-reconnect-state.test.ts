import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { isAuthenticationFailure } from "../src/shared/auth.ts"

type Screen = "startup" | "servers" | "login" | "signing-in" | "chat"
type Element = { type: unknown; props: Record<string, any> }

function fixture(initialScreen: Screen = "chat") {
  const chat = Symbol("ChatPage")
  const signingIn = Symbol("SigningInPage")
  const listeners = new Set<(event: { targetId: string; state: string }) => void>()
  const slots: any[] = [initialScreen]
  let cursor = 0
  let effectCursor = 0
  const effects = new Map<number, { deps: unknown[]; cleanup?: () => void }>()
  let pending: Array<() => void> = []
  const react = {
    useState(initial: any) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial
      return [
        slots[index],
        (value: any) => {
          slots[index] = typeof value === "function" ? value(slots[index]) : value
        },
      ]
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback: (fn: Function) => fn,
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const index = effectCursor++
      const previous = effects.get(index)
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
      pending.push(() => {
        previous?.cleanup?.()
        effects.set(index, { deps, cleanup: effect() || undefined })
      })
    },
  }
  const connection = {
    targetId: "target",
    server: {
      id: "saved",
      name: "测试服务器",
      url: "https://example.test",
      builtin: false,
    },
    info: { organizationName: "组织" },
    user: { id: "user", name: "用户" },
  }
  const noop = () => {}
  const accepted: unknown[] = []
  const toasts: Array<{ title: string; description?: string }> = []
  const props = {
    theme: "light",
    resolvedTheme: "light",
    onThemeChange: noop,
    onOrganizationNameChange: noop,
  }
  const fallback = new Proxy({}, { get: () => noop })
  const source = readFileSync(
    new URL("../src/renderer/features/auth/login-page.tsx", import.meta.url),
    "utf8",
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const exports: Record<string, any> = {}
  runInNewContext(compiled, {
    exports,
    document: { createElement: () => ({ getContext: () => null }) },
    window: {
      desktop: {
        onOpenSettings: () => noop,
        onRequestQuit: () => noop,
        onOpenMessageNotification: () => noop,
        accountData: {
          onSyncStateChange: (listener: (event: { targetId: string; state: string }) => void) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
        },
      },
    },
    require: (name: string) => {
      if (name === "react") return react
      if (name === "../../../shared/auth") return { isAuthenticationFailure }
      if (name === "react/jsx-runtime") {
        const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
        return { jsx, jsxs: jsx, Fragment: Symbol("Fragment") }
      }
      if (name.endsWith("/chat/chat-page")) return { ChatPage: chat }
      if (name === "./signing-in-page") return { SigningInPage: signingIn }
      if (name === "./use-connection")
        return {
          useConnection: () => ({
            connection,
            catalog: { activeServerId: connection.server.id, servers: [connection.server] },
            loading: false,
            isPreview: false,
            accept: (value: unknown) => accepted.push(value),
            acceptUser: noop,
            acceptCatalog: noop,
            reloadCatalog: noop,
            connect: noop,
            clearError: noop,
            retry: noop,
          }),
        }
      if (name.endsWith("animated-toast-provider"))
        return {
          useAnimatedToast: () => ({
            showToast: (toast: (typeof toasts)[number]) => toasts.push({ ...toast }),
          }),
        }
      return fallback
    },
  })
  function find(node: any, type: unknown): Element | undefined {
    if (!node || typeof node !== "object") return
    if (node.type === type) return node
    for (const child of [node.props?.children].flat()) {
      const result = find(child, type)
      if (result) return result
    }
  }
  function render() {
    cursor = 0
    effectCursor = 0
    const tree = exports.LoginPage(props)
    const jobs = pending
    pending = []
    for (const effect of jobs) effect()
    return { chat: find(tree, chat), signingIn: find(tree, signingIn) }
  }
  return {
    render,
    accepted,
    toasts,
    screen: () => slots[0] as Screen,
    emit: (state: string, targetId = "target") => {
      for (const listener of listeners) listener({ targetId, state })
    },
    cleanup: () => {
      for (const effect of effects.values()) effect.cleanup?.()
    },
  }
}

test("进入聊天后后台断线、重连和同步不会卸载聊天页或返回初始化页", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  assert.ok(f.render().chat)
  for (const state of ["loading", "loading", "ready", "loading", "ready"]) {
    f.emit(state)
    const page = f.render()
    assert.equal(f.screen(), "chat")
    assert.ok(page.chat)
    assert.equal(page.signingIn, undefined)
  }
})

test("其他账号的后台同步不影响当前聊天页", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  f.render()
  f.emit("loading", "other-target")
  assert.ok(f.render().chat)
})

test("首次进入仍通过初始化完成回调进入聊天，不把后台ready当作界面导航", (t) => {
  const f = fixture("signing-in")
  t.after(f.cleanup)
  assert.ok(f.render().signingIn)
  f.emit("ready")
  const page = f.render()
  assert.equal(f.screen(), "signing-in")
  page.signingIn!.props.onComplete()
  assert.ok(f.render().chat)
})

for (const code of ["network", "invalid_argument", "http_500", "forbidden"]) {
  test(`手动刷新失败${code}保留登录，显示实际同步错误而非初始化失败`, (t) => {
    const f = fixture()
    t.after(f.cleanup)
    f.render().chat!.props.onRefresh()
    const page = f.render()
    page.signingIn!.props.onFailure({ code, message: "同步请求的具体错误" })
    assert.ok(f.render().chat)
    assert.equal(f.accepted.length, 0)
    assert.deepEqual(f.toasts.at(-1), {
      status: "error",
      title: "刷新失败",
      description: "同步请求的具体错误",
    })
  })
}

for (const code of [
  "unauthorized",
  "not_authenticated",
  "invalid_session",
  "expired_session",
  "http_401",
]) {
  test(`手动刷新遇到认证失效${code}仍退出聊天，不掩盖真正的登录错误`, (t) => {
    const f = fixture()
    t.after(f.cleanup)
    f.render().chat!.props.onRefresh()
    f.render().signingIn!.props.onFailure({ code, message: "登录已失效" })
    assert.equal(f.screen(), "servers")
    assert.equal(f.accepted.length, 1)
  })
}

test("首次初始化失败仍按原有失败路径退出，不伪装成已初始化成功", (t) => {
  const f = fixture("signing-in")
  t.after(f.cleanup)
  f.render().signingIn!.props.onFailure({ code: "network", message: "无法初始化" })
  assert.equal(f.screen(), "servers")
  assert.equal(f.accepted.length, 1)
})

test("用户主动刷新仍能进入完整同步流程", (t) => {
  const f = fixture()
  t.after(f.cleanup)
  const page = f.render()
  page.chat!.props.onRefresh()
  const next = f.render()
  assert.equal(f.screen(), "signing-in")
  assert.ok(next.signingIn)
  assert.equal(next.signingIn.props.refreshAll, true)
})
