import assert from "node:assert/strict"
import test from "node:test"

import { RealtimeRecovery } from "../src/realtime/realtime-recovery.ts"

const flush = async () => { for (let index = 0; index < 4; index++) await Promise.resolve() }

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function fixture(autoRun = true) {
  const states: boolean[] = []
  const errors: unknown[] = []
  const pending: ReturnType<typeof deferred>[] = []
  const queued: (() => Promise<void>)[] = []
  let current = true
  const recovery = new RealtimeRecovery({
    enqueue: (task) => { if (autoRun) void task(); else queued.push(task) },
    isCurrent: () => current,
    onChange: (state) => states.push(state),
    onError: (error) => errors.push(error),
    shouldRetry: (error) => !(error instanceof Error && error.message === "unauthorized"),
    synchronize: () => { const operation = deferred(); pending.push(operation); return operation.promise },
  })
  return { recovery, states, errors, pending, queued, invalidate: () => { current = false } }
}

test("首次连接及握手后保持恢复中，补同步完成才恢复标题", async (t) => {
  const f = fixture()
  t.after(() => f.recovery.dispose())
  f.recovery.setReady(false)
  assert.equal(f.states.at(-1), true)
  assert.equal(f.pending.length, 0)
  f.recovery.setReady(true)
  assert.equal(f.pending.length, 1)
  assert.equal(f.states.at(-1), true)
  f.pending[0]!.resolve()
  await flush()
  assert.equal(f.states.at(-1), false)
})

test("重复ready和前台唤醒不重复补同步，健康连接不闪连接标题", async (t) => {
  const f = fixture()
  t.after(() => f.recovery.dispose())
  f.recovery.setReady(true)
  f.recovery.setReady(true)
  f.recovery.retry()
  assert.equal(f.pending.length, 1)
  f.pending[0]!.resolve()
  await flush()
  const completedStates = [...f.states]
  f.recovery.setReady(true)
  f.recovery.retry()
  assert.equal(f.pending.length, 1)
  assert.deepEqual(f.states, completedStates)
})

test("再次断线后旧同步结果不能提前清掉新一轮连接标题", async (t) => {
  const f = fixture()
  t.after(() => f.recovery.dispose())
  f.recovery.setReady(true)
  f.recovery.setReady(false)
  f.recovery.setReady(true)
  assert.equal(f.pending.length, 2)
  f.pending[0]!.resolve()
  await flush()
  assert.equal(f.states.at(-1), true)
  f.pending[1]!.resolve()
  await flush()
  assert.equal(f.states.at(-1), false)
})

test("HTTP补同步失败保持连接标题，按1至30秒退避重试而不重建Socket", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture()
  t.after(() => f.recovery.dispose())
  f.recovery.setReady(true)
  for (let attempt = 1; attempt <= 31; attempt++) {
    f.pending.at(-1)!.reject(new Error("offline"))
    await flush()
    assert.equal(f.states.at(-1), true)
    t.mock.timers.tick(Math.min(attempt, 30) * 1_000 - 1)
    assert.equal(f.pending.length, attempt)
    t.mock.timers.tick(1)
    assert.equal(f.pending.length, attempt + 1)
  }
  f.pending.at(-1)!.resolve()
  await flush()
  assert.equal(f.states.at(-1), false)
  assert.equal(f.errors.length, 31)
})

test("断线取消HTTP重试，重新握手后再开始同步", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture()
  t.after(() => f.recovery.dispose())
  f.recovery.setReady(true)
  f.pending[0]!.reject(new Error("offline"))
  await flush()
  f.recovery.setReady(false)
  t.mock.timers.tick(60_000)
  assert.equal(f.pending.length, 1)
  f.recovery.setReady(true)
  assert.equal(f.pending.length, 2)
})

test("过期的排队任务不发请求，新连接仍可完成", async (t) => {
  const f = fixture(false)
  t.after(() => f.recovery.dispose())
  f.recovery.setReady(true)
  f.recovery.setReady(false)
  await f.queued.shift()!()
  assert.equal(f.pending.length, 0)
  f.recovery.setReady(true)
  const task = f.queued.shift()!()
  f.pending[0]!.resolve()
  await task
  assert.equal(f.states.at(-1), false)
})

test("退出或切换账号后不发布旧状态，也不继续重试", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture()
  f.recovery.setReady(true)
  f.recovery.dispose()
  const states = [...f.states]
  f.pending[0]!.reject(new Error("offline"))
  await flush()
  t.mock.timers.tick(60_000)
  f.recovery.setReady(true)
  f.recovery.retry()
  assert.deepEqual(f.states, states)
  assert.equal(f.pending.length, 1)
  assert.deepEqual(f.errors, [])
})

test("账号代际已失效时忽略迟到的成功结果", async (t) => {
  const f = fixture()
  t.after(() => f.recovery.dispose())
  f.recovery.setReady(true)
  f.invalidate()
  f.pending[0]!.resolve()
  await flush()
  assert.deepEqual(f.states, [true])
})

test("认证失效交回认证处理，不继续HTTP自动重试", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const f = fixture()
  t.after(() => f.recovery.dispose())
  f.recovery.setReady(true)
  f.pending[0]!.reject(new Error("unauthorized"))
  await flush()
  t.mock.timers.tick(60_000)
  assert.equal(f.errors.length, 1)
  assert.equal(f.pending.length, 1)
  assert.deepEqual(f.states, [true])
})
