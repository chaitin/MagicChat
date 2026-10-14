import assert from "node:assert/strict"
import test from "node:test"
import { createMobileStartupTracer } from "../src/diagnostics/mobile-startup.ts"

test("启动计时仅输出阶段和有限数值，过滤额外敏感字段", () => {
  let clock = 10
  const lines: string[] = []
  const trace = createMobileStartupTracer({ enabled: true, now: () => clock, log: (line) => lines.push(line) })
  clock = 25
  trace("previews.load.ready", {
    count: 30,
    loaded: 28,
    elapsedMs: 12.4,
    queueMs: Number.NaN,
    executionMs: Number.POSITIVE_INFINITY,
    ...{ userId: "private-user", content: "private-message" },
  })
  assert.deepEqual(JSON.parse(lines[0].slice("[mobile-startup] ".length)), {
    phase: "previews.load.ready", atMs: 15, elapsedMs: 12, count: 30, loaded: 28,
  })
  assert.equal(lines[0].includes("private"), false)
})

test("普通构建关闭启动计时，日志失败也不影响业务", () => {
  const disabled = createMobileStartupTracer({ enabled: false, log: () => { throw new Error("不应输出") } })
  assert.doesNotThrow(() => disabled("previews.load.start", { count: 20 }))
  const failed = createMobileStartupTracer({ enabled: true, log: () => { throw new Error("日志不可用") } })
  assert.doesNotThrow(() => failed("previews.load.start", { count: 20 }))
})
