import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import * as auth from "../src/shared/auth.ts"
import type { AuthResult, Connection, RestoredSession, ServerCatalog } from "../src/shared/auth.ts"

const catalog: ServerCatalog = {
  activeServerId: "saved",
  servers: [
    {
      id: auth.OFFICIAL_SERVER_ID,
      name: "演示服务器",
      url: auth.OFFICIAL_SERVER_URL,
      builtin: true,
    },
    { id: "saved", name: "已保存的服务器", url: "https://saved.example.test", builtin: false },
  ],
}
const failure = (code = "network") => ({ ok: false, error: { code, message: "暂不可用" } }) as const
const success = <T>(data: T): AuthResult<T> => ({ ok: true, data })
const session = (connection: Connection | null = null, value = catalog) =>
  success({ catalog: value, connection })
const source = readFileSync(
  new URL("../src/renderer/features/auth/use-connection.ts", import.meta.url),
  "utf8",
)
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

type Pending<T> = {
  resolve: (value: AuthResult<T>) => void
  reject: (error: Error) => void
}
type Slot = {
  value?: any
  deps?: unknown[]
  effect?: () => (() => void) | void
  cleanup?: () => void
}

function fixture(preview = false) {
  const slots: Slot[] = []
  let cursor = 0,
    dirty = true,
    mounted = true,
    data: any,
    writesAfterUnmount = 0
  let jobs: Array<() => void> = []
  const timers = new Map<number, () => void>()
  let timerId = 0
  const counts = { catalog: 0, session: 0, connect: 0 }
  const catalogRequests: Pending<ServerCatalog>[] = []
  const sessionRequests: Pending<RestoredSession>[] = []
  const connectRequests: Array<Pending<Connection> & { serverId: string }> = []
  const same = (a?: unknown[], b?: unknown[]) =>
    Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])))
  function memo(compute: () => unknown, deps: unknown[]) {
    const slot = (slots[cursor++] ??= {})
    if (!same(slot.deps, deps)) {
      slot.value = compute()
      slot.deps = deps
    }
    return slot.value
  }
  const react = {
    useState(initial: any) {
      const slot = (slots[cursor++] ??= {
        value: typeof initial === "function" ? initial() : initial,
      })
      return [
        slot.value,
        (next: any) => {
          if (!mounted) {
            writesAfterUnmount++
            return
          }
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
    useCallback: (fn: Function, deps: unknown[]) => memo(() => fn, deps),
    useEffect(fn: () => (() => void) | void, deps: unknown[]) {
      const slot = (slots[cursor++] ??= {})
      if (same(slot.deps, deps)) return
      slot.deps = deps
      slot.effect = fn
      jobs.push(() => {
        slot.cleanup?.()
        slot.cleanup = fn() || undefined
      })
    },
  }
  const bridge = {
    getServers: () => {
      counts.catalog++
      return new Promise<AuthResult<ServerCatalog>>((resolve, reject) =>
        catalogRequests.push({ resolve, reject }),
      )
    },
    restoreLastSession: () => {
      counts.session++
      return new Promise<AuthResult<RestoredSession>>((resolve, reject) =>
        sessionRequests.push({ resolve, reject }),
      )
    },
    connect: (serverId: string) => {
      counts.connect++
      return new Promise<AuthResult<Connection>>((resolve, reject) =>
        connectRequests.push({ serverId, resolve, reject }),
      )
    },
  }
  const module = { exports: {} as any }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    window: { desktop: preview ? undefined : { auth: bridge } },
    setTimeout: (fn: () => void) => {
      timers.set(++timerId, fn)
      return timerId
    },
    require: (name: string) => {
      if (name === "react") return react
      if (name === "../../../shared/auth") return auth
      throw new Error("未预期的依赖：" + name)
    },
  })
  async function flush() {
    for (let step = 0; step < 40; step++) {
      for (let i = 0; i < 12; i++) await Promise.resolve()
      if (!mounted || !dirty) return
      dirty = false
      cursor = 0
      data = module.exports.useConnection()
      const effects = jobs
      jobs = []
      for (const effect of effects) effect()
    }
    throw new Error("连接初始化未稳定")
  }
  return {
    flush,
    counts,
    catalogRequests,
    sessionRequests,
    connectRequests,
    get data() {
      return data
    },
    get writesAfterUnmount() {
      return writesAfterUnmount
    },
    async local(value: AuthResult<ServerCatalog> = success(catalog)) {
      catalogRequests.shift()!.resolve(value)
      await flush()
    },
    async restored(value: AuthResult<RestoredSession> = session()) {
      sessionRequests.shift()!.resolve(value)
      await flush()
    },
    async tick() {
      const pending = [...timers.values()]
      timers.clear()
      for (const fn of pending) fn()
      await flush()
    },
    async replay() {
      for (const slot of slots)
        if (slot.effect) {
          slot.cleanup?.()
          slot.cleanup = slot.effect() || undefined
        }
      await flush()
    },
    unmount() {
      for (const slot of slots) slot.cleanup?.()
      mounted = false
    },
  }
}

function connection(value = catalog): Connection {
  return {
    targetId: "target",
    server: value.servers.find((server) => server.id === value.activeServerId)!,
    user: null,
    info: {
      appName: "测试",
      organizationName: "团队",
      emailCodeLoginEnabled: true,
      passwordLoginEnabled: true,
      thirdPartyProviders: [],
    },
  }
}

test("本地服务器列表不等待联网恢复，恢复失败也不丢失列表", async () => {
  const f = fixture()
  await f.flush()
  assert.equal(f.data.catalog.servers.length, 0)
  await f.local()
  assert.equal(f.data.catalog.servers.length, 2)
  assert.equal(f.data.server.id, "saved")
  await f.restored(failure())
  assert.equal(f.data.catalog.servers.length, 2)
  assert.equal(f.data.error.code, "network")
  assert.equal(f.data.loading, false)
  assert.equal(f.counts.catalog, 1)
})

test("自动登录先失败而本地列表后返回时仍正确展示已保存服务器", async () => {
  const f = fixture()
  await f.flush()
  await f.restored(failure())
  await f.local()
  assert.equal(f.data.catalog.servers.length, 2)
  assert.equal(f.data.loading, false)
})

for (const restoredFirst of [true, false]) {
  test("恢复更新的服务器不会被较旧本地快照覆盖：" + restoredFirst, async () => {
    const f = fixture()
    const next = { ...catalog, activeServerId: auth.OFFICIAL_SERVER_ID }
    const connected = connection(next)
    await f.flush()
    if (restoredFirst) {
      await f.restored(session(connected, next))
      await f.local()
    } else {
      await f.local()
      await f.restored(session(connected, next))
    }
    assert.equal(f.data.catalog.activeServerId, auth.OFFICIAL_SERVER_ID)
    assert.equal(f.data.server.id, f.data.connection.server.id)
    assert.equal(f.data.connection.targetId, "target")
    assert.equal(f.data.error, null)
  })
}

test("本地目录IPC失败但恢复成功时使用恢复返回的有效目录", async () => {
  const f = fixture()
  await f.flush()
  await f.local(failure("storage"))
  await f.restored(session(connection()))
  assert.equal(f.data.catalog.servers.length, 2)
  assert.equal(f.data.error, null)
})

test("StrictMode重放只读取一次目录并恢复一次登录", async () => {
  const f = fixture()
  await f.flush()
  await f.replay()
  assert.equal(f.counts.catalog, 1)
  assert.equal(f.counts.session, 1)
  await f.local()
  await f.restored(session(connection()))
  assert.equal(f.data.connection.targetId, "target")
  assert.equal(f.data.loading, false)
})

test("卸载后的启动结果不会更新状态", async () => {
  const f = fixture()
  await f.flush()
  f.unmount()
  await f.local()
  await f.restored(session(connection()))
  assert.equal(f.writesAfterUnmount, 0)
})

test("IPC尚未就绪时有限重试，失败后仍可手动重新加载而无需重启", async () => {
  const f = fixture()
  await f.flush()
  await f.restored(failure())
  for (let attempt = 0; attempt < 3; attempt++) {
    await f.local(failure(attempt === 1 ? "busy" : "bridge"))
    if (attempt < 2) await f.tick()
  }
  assert.equal(f.counts.catalog, 3)
  assert.equal(f.data.loading, false)
  assert.equal(f.data.catalog.servers.length, 0)
  await f.tick()
  assert.equal(f.counts.catalog, 3)
  const reloading = f.data.reloadCatalog()
  await f.flush()
  await f.local()
  assert.equal((await reloading).ok, true)
  assert.equal(f.counts.catalog, 4)
  assert.equal(f.counts.session, 1)
  assert.equal(f.data.error, null)
  assert.equal(f.data.catalog.servers.length, 2)
})

test("被拒绝的目录IPC不会泄漏内部错误，并可重试恢复", async () => {
  const f = fixture()
  await f.flush()
  f.catalogRequests.shift()!.reject(new Error("private-path-and-token"))
  await f.flush()
  await f.tick()
  await f.local()
  await f.restored(failure())
  assert.equal(f.counts.catalog, 2)
  assert.equal(f.data.catalog.servers.length, 2)
  assert.ok(!JSON.stringify(f.data.error).includes("private-path-and-token"))
})

test("被拒绝的恢复IPC不影响本地目录", async () => {
  const f = fixture()
  await f.flush()
  await f.local()
  f.sessionRequests.shift()!.reject(new Error("private-error"))
  await f.flush()
  assert.equal(f.data.catalog.servers.length, 2)
  assert.equal(f.data.error.code, "bridge")
  assert.ok(!f.data.error.message.includes("private-error"))
})

test("重复点击重新加载共享同一个目录请求，不重新执行自动登录", async () => {
  const f = fixture()
  await f.flush()
  await f.local(failure("storage"))
  await f.restored(failure())
  const first = f.data.reloadCatalog()
  const second = f.data.reloadCatalog()
  await f.flush()
  assert.equal(f.counts.catalog, 2)
  await f.local()
  assert.equal((await first).ok, true)
  assert.equal((await second).ok, true)
  assert.equal(f.counts.session, 1)
})

test("重新读取失败时保留上一次有效列表，恢复后错误清除", async () => {
  const f = fixture()
  await f.flush()
  await f.local()
  await f.restored()
  const failed = f.data.reloadCatalog()
  await f.flush()
  await f.local(failure("storage"))
  assert.equal((await failed).ok, false)
  assert.equal(f.data.catalog.servers.length, 2)
  assert.equal(f.data.error.code, "storage")
  const retry = f.data.reloadCatalog()
  await f.flush()
  await f.local()
  await retry
  assert.equal(f.data.error, null)
})

test("恢复失败后的连接重试使用已保存服务器，而非默认演示服务器", async () => {
  const f = fixture()
  await f.flush()
  await f.local()
  await f.restored(failure())
  const retry = f.data.retry()
  await f.flush()
  assert.equal(f.connectRequests[0].serverId, "saved")
  const reload = await f.data.reloadCatalog()
  assert.equal(reload.ok, false)
  assert.equal(f.counts.catalog, 1)
  f.connectRequests.shift()!.resolve(success(connection()))
  await retry
  await f.flush()
  assert.equal(f.data.connection.server.id, "saved")
})

test("浏览器预览保留演示目录且不调用桌面IPC", async () => {
  const f = fixture(true)
  await f.flush()
  assert.equal(f.data.catalog.servers.length, 1)
  assert.equal(f.data.isPreview, true)
  assert.equal(f.data.loading, false)
  assert.equal(f.counts.catalog, 0)
  assert.equal(f.counts.session, 0)
})

test("服务器列表错误页提供真正的目录重载入口，目录未知时禁止添加服务器", async () => {
  let calls = 0
  const jsx = (type: unknown, props: any) => ({ type, props })
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/renderer/features/auth/server-select-page.tsx", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText
  const module = { exports: {} as any }
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === "react")
        return {
          useEffect: () => {},
          useRef: () => ({ current: "" }),
          useState: (value: unknown) => [value, () => {}],
        }
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx }
      if (name === "@/components/motion/animated-toast-provider")
        return { useAnimatedToast: () => ({ showToast: () => {} }) }
      if (name === "@/lib/utils") return { cn: () => "" }
      return new Proxy({}, { get: (_target, key) => key })
    },
  })
  const tree = module.exports.ServerSelectPage({
    catalog: { activeServerId: auth.OFFICIAL_SERVER_ID, servers: [] },
    loading: false,
    isPreview: false,
    initialError: "配置读取失败",
    theme: "system",
    onReloadCatalog: async () => {
      calls++
      return success(catalog)
    },
  })
  const buttons: any[] = []
  function visit(node: any) {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (node.type === "Button") buttons.push(node)
    visit(node.props?.children)
  }
  visit(tree)
  const text = (node: any): string =>
    typeof node === "string"
      ? node
      : Array.isArray(node)
        ? node.map(text).join("")
        : text(node?.props?.children ?? "")
  const reload = buttons.find((node) => text(node.props.children).includes("重新加载服务器列表"))
  assert.ok(reload)
  assert.equal(reload.props.disabled, false)
  reload.props.onClick()
  await Promise.resolve()
  assert.equal(calls, 1)
  assert.equal(
    buttons.find((node) => text(node.props.children).includes("添加服务器")).props.disabled,
    true,
  )
})
