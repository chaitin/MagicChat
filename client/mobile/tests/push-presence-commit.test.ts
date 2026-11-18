import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { createPushPresenceReporter, PUSH_PRESENCE_HEARTBEAT_MS } from "../../shared/push-presence.ts"

test("推送心跳只使用已提交的就绪状态，状态变化不重建上报器", async () => {
  const source = ts.createSourceFile(
    "push-provider.tsx",
    readFileSync(new URL("../src/providers/push-provider.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const provider = source.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "PushProvider",
  )
  assert.ok(provider?.body)
  const statements = provider.body.statements.filter((node) => {
    if (ts.isVariableStatement(node)) {
      return node.declarationList.declarations.some((declaration) =>
        ["presenceReadyRef", "presenceReporterRef", "presenceRequestQueueRef"].includes(
          declaration.name.getText(source),
        ),
      )
    }
    if (!ts.isExpressionStatement(node)) return false
    if (ts.isBinaryExpression(node.expression)) {
      return node.expression.left.getText(source) === "presenceReadyRef.current"
    }
    return ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(source) === "useEffect" &&
      /presenceReadyRef|presenceReporterRef/.test(node.getText(source))
  })
  const code = ts.transpileModule(
    "exports.renderPresence = (realtimeReady, isMessageBootstrapComplete) => {" +
      statements.map((node) => node.getText(source)).join("\n") + "}",
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText
  type Effect = {
    run: () => (() => void) | void
    deps: unknown[]
    cleanup?: () => void
  }
  const refs: { current: unknown }[] = []
  const committed: Effect[] = []
  let pending: Effect[] = []
  let refCursor = 0
  let reporters = 0
  let subscriptions = 0
  let heartbeat: (() => void) | undefined
  let onAppState: ((state: string) => void) | undefined
  const calls: boolean[] = []
  const appState = {
    currentState: "active",
    addEventListener(_event: string, callback: (state: string) => void) {
      subscriptions++
      onAppState = callback
      return { remove() { onAppState = undefined } }
    },
  }
  const exports = {} as { renderPresence: (ready: boolean, complete: boolean) => void }
  runInNewContext(code, {
    exports,
    useRef(initial: unknown) {
      const index = refCursor++
      if (index === refs.length) refs.push({ current: initial })
      return refs[index]
    },
    useEffect(run: Effect["run"], deps: unknown[]) { pending.push({ run, deps }) },
    AppState: appState,
    Platform: { OS: "android" },
    identity: { target: { id: "server", url: "https://example.test", userId: "user" } },
    isAuthenticated: true,
    isSigningOut: false,
    createPushPresenceReporter(send: (foreground: boolean) => Promise<unknown>) {
      reporters++
      return createPushPresenceReporter(send)
    },
    reportPushPresence: async (_target: unknown, _platform: string, foreground: boolean) => {
      calls.push(foreground)
    },
    PUSH_PRESENCE_HEARTBEAT_MS,
    setInterval(callback: () => void, delay: number) {
      assert.equal(delay, PUSH_PRESENCE_HEARTBEAT_MS)
      heartbeat = callback
      return 1
    },
    clearInterval() { heartbeat = undefined },
  })
  function render(ready: boolean, complete: boolean) {
    pending = []
    refCursor = 0
    exports.renderPresence(ready, complete)
  }
  function commit() {
    pending.forEach((effect, index) => {
      const previous = committed[index]
      if (previous && effect.deps.every((value, i) => Object.is(value, previous.deps[i]))) return
      previous?.cleanup?.()
      effect.cleanup = effect.run() ?? undefined
      committed[index] = effect
    })
  }
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
  try {
    render(true, true)
    assert.deepEqual(calls, [])
    assert.equal(refs[0].current, false)
    commit()
    await flush()
    assert.ok(calls.length > 0 && calls.every((foreground) => foreground))
    calls.length = 0

    render(false, true)
    assert.equal(refs[0].current, true)
    onAppState!("active")
    await flush()
    assert.deepEqual(calls, [true])
    calls.length = 0

    render(false, true)
    commit()
    await flush()
    assert.deepEqual(calls, [false])
    heartbeat!()
    await flush()
    assert.deepEqual(calls, [false])

    render(true, false)
    commit()
    await flush()
    assert.equal(refs[0].current, false)

    render(true, true)
    commit()
    await flush()
    assert.deepEqual(calls, [false, true])
    appState.currentState = "background"
    onAppState!("background")
    await flush()
    assert.deepEqual(calls, [false, true, false])
    assert.equal(reporters, 1)
    assert.equal(subscriptions, 1)
  } finally {
    committed.forEach((effect) => effect.cleanup?.())
    await flush()
  }
  assert.equal(onAppState, undefined)
  assert.equal(heartbeat, undefined)
})
