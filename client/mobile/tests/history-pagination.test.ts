import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

function fixture(initial: Record<string, unknown> = {}) {
  const refs: { current: unknown }[] = []
  const memos: { deps: unknown[]; value: unknown }[] = []
  const effects: { deps: unknown[]; cleanup?: () => void }[] = []
  const frames = new Map<number, () => void>()
  let refIndex = 0, memoIndex = 0, effectIndex = 0, frameId = 0, calls = 0
  let options = {
    conversationId: "room", cursor: 51, hasOlder: true,
    isLoading: false, isFetchingOlder: false, error: null,
    onLoadOlder: () => { calls++ }, ...initial,
  }
  const changed = (previous: unknown[] | undefined, next: unknown[]) =>
    !previous || next.some((value, index) => !Object.is(value, previous[index]))
  const code = ts.transpileModule(readFileSync(new URL(
    "../src/features/conversation/messages/use-message-history-pagination.ts", import.meta.url
  ), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  type Pagination = {
    updateMetrics: (patch: { contentHeight?: number; viewportHeight?: number; offset?: number }) => void
    onReachOlder: () => void
    onRetryOlder: () => void
  }
  const exports = {} as { useMessageHistoryPagination: (input: unknown) => Pagination }
  runInNewContext(code, {
    exports,
    requestAnimationFrame: (run: () => void) => { frames.set(++frameId, run); return frameId },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    require: (name: string) => {
      assert.equal(name, "react")
      return {
        useRef(value: unknown) { return refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }) },
        useCallback(value: unknown, deps: unknown[]) {
          const index = memoIndex++
          if (changed(memos[index]?.deps, deps)) memos[index] = { deps, value }
          return memos[index].value
        },
        useEffect(run: () => void | (() => void), deps: unknown[]) {
          const index = effectIndex++
          if (!changed(effects[index]?.deps, deps)) return
          effects[index]?.cleanup?.()
          effects[index] = { deps, cleanup: run() || undefined }
        },
      }
    },
  })
  let pagination: Pagination
  function render(patch: Record<string, unknown> = {}) {
    options = { ...options, ...patch }
    refIndex = memoIndex = effectIndex = 0
    pagination = exports.useMessageHistoryPagination(options)
    return pagination
  }
  return {
    render,
    calls: () => calls,
    flush() {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((run) => run())
    },
    dispose() { effects.forEach((effect) => effect.cleanup?.()) },
  }
}

test("到达历史顶部时滚动与 FlatList 回调同时触发也只请求一次", () => {
  const f = fixture(), list = f.render()
  list.updateMetrics({ contentHeight: 2000, viewportHeight: 600, offset: 1400 })
  list.onReachOlder()
  f.flush()
  assert.equal(f.calls(), 1)
})

test("加载结束仍在顶部时补检查，不依赖新的边界或滚动事件", () => {
  const f = fixture({ isFetchingOlder: true })
  f.render().updateMetrics({ contentHeight: 2000, viewportHeight: 600, offset: 1400 })
  assert.equal(f.calls(), 0)
  f.render({ isFetchingOlder: false })
  f.flush()
  assert.equal(f.calls(), 1)
})

test("分页失败后停止自动重试，但允许手动重试相同游标", () => {
  const f = fixture()
  f.render().updateMetrics({ contentHeight: 2000, viewportHeight: 600, offset: 1400 })
  const failed = f.render({ error: new Error("offline") })
  failed.onReachOlder()
  failed.updateMetrics({ offset: 1400 })
  f.flush()
  assert.equal(f.calls(), 1)
  failed.onRetryOlder()
  assert.equal(f.calls(), 2)
})

test("重复页不推进游标时不会无限加载，真实游标推进后可继续加载", () => {
  const f = fixture(), list = f.render()
  list.updateMetrics({ contentHeight: 2000, viewportHeight: 600, offset: 1400 })
  f.render({ isFetchingOlder: true })
  f.render({ isFetchingOlder: false })
  f.flush()
  assert.equal(f.calls(), 1)
  f.render({ cursor: 31 })
  f.flush()
  assert.equal(f.calls(), 2)
})

test("未完成测量或远离历史顶部时不自动加载，短列表可继续补齐", () => {
  const f = fixture(), list = f.render()
  list.updateMetrics({ viewportHeight: 600 })
  f.flush()
  assert.equal(f.calls(), 0)
  list.updateMetrics({ contentHeight: 2000, offset: 0 })
  assert.equal(f.calls(), 0)
  list.updateMetrics({ contentHeight: 300 })
  assert.equal(f.calls(), 1)
})

test("切换会话不复用旧测量结果，相同游标也可加载", () => {
  const f = fixture()
  f.render().updateMetrics({ contentHeight: 2000, viewportHeight: 600, offset: 1400 })
  const next = f.render({ conversationId: "other" })
  f.flush()
  assert.equal(f.calls(), 1)
  next.updateMetrics({ contentHeight: 2000, viewportHeight: 600, offset: 1400 })
  assert.equal(f.calls(), 2)
})

test("初始加载、分页中或没有更早消息时禁止重试，卸载取消补检查", () => {
  for (const options of [{ isLoading: true }, { isFetchingOlder: true }, { hasOlder: false }]) {
    const f = fixture(options), list = f.render()
    list.updateMetrics({ contentHeight: 300, viewportHeight: 600 })
    list.onRetryOlder()
    f.flush()
    assert.equal(f.calls(), 0)
    f.dispose()
  }
  const f = fixture()
  const list = f.render()
  list.updateMetrics({ contentHeight: 2000, viewportHeight: 600, offset: 0 })
  f.dispose()
  f.flush()
  assert.equal(f.calls(), 0)
})

test("已有消息时仍显示历史分页错误与重试入口，重试不刷新最新页", () => {
  const source = readFileSync(new URL("../src/features/conversation/messages/message-list.tsx", import.meta.url), "utf8")
  assert.match(source, /ListFooterComponent={[\s\S]*olderError[\s\S]*onPress={onRetryOlder}/)
  const screen = readFileSync(new URL("../src/features/conversation/conversation-screen.tsx", import.meta.url), "utf8")
  assert.match(screen, /fetchOlder\({ cancelRefetch: false }\)/)
  assert.match(screen, /olderError={messagesQuery.olderError}/)
})
