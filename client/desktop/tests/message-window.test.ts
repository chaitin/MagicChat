import assert from "node:assert/strict"
import test from "node:test"
import type { DesktopMessage } from "../src/shared/account-data.ts"
import {
  advanceLocalMessageGap,
  contiguousMessageSuffix,
  isCompleteLocalPage,
  mergeLocalMessageWindows,
} from "../src/shared/message-window.ts"

test("初始消息窗口只保留连续的最新缓存", () => {
  assert.deepEqual(
    contiguousMessageSuffix(messages(1, 2, 81, 82, 83)).map((message) => message.seq),
    [81, 82, 83],
  )
})

test("连续的完整本地分页可以直接使用", () => {
  assert.equal(isCompleteLocalPage(messages(...range(81, 100)), 101), true)
  assert.equal(isCompleteLocalPage(messages(1, 2), 3), true)
})

test("本地分页不足或存在断档时回退 API", () => {
  assert.equal(isCompleteLocalPage(messages(91, 92), 101), false)
  assert.equal(isCompleteLocalPage(messages(97, 99, 100), 101), false)
})

test("定位旧附件时保留最新消息，并在不连续窗口间显示缺口", () => {
  const older = messages(...range(10, 50))
  const latest = messages(...range(101, 150))
  const window = mergeLocalMessageWindows(older, latest)
  assert.deepEqual(window.gap, { afterSeq: 50, beforeSeq: 101 })
  assert.deepEqual(
    window.messages.map((message) => message.seq),
    [...range(10, 50), ...range(101, 150)],
  )
})

test("滚动到缺口时按本地分页逐步拼接，缺失缓存时保留提示", () => {
  const gap = { afterSeq: 50, beforeSeq: 151 }
  const first = advanceLocalMessageGap(gap, messages(...range(51, 100)))
  assert.deepEqual(first, { afterSeq: 100, beforeSeq: 151 })
  assert.equal(advanceLocalMessageGap(first!, messages(...range(101, 151))), null)
  assert.deepEqual(advanceLocalMessageGap(gap, messages(151)), {
    ...gap,
    unavailable: true,
  })
})

test("历史窗口与当前窗口重叠时去重且不留下缺口", () => {
  const window = mergeLocalMessageWindows(messages(...range(40, 80)), messages(...range(60, 110)))
  assert.equal(window.gap, null)
  assert.deepEqual(
    window.messages.map((message) => message.seq),
    range(40, 110),
  )
})

for (const status of ["sending", "failed"] as const) {
  test(`${status}临时序号与正式消息重叠，不截断连续历史且保留临时消息`, () => {
    const pending = { ...messages(82)[0], id: "pending", deliveryStatus: status }
    const rows = [...messages(1, 2, 81), pending, ...messages(82, 83)]
    assert.deepEqual(
      contiguousMessageSuffix(rows).map((message) => message.id),
      ["message-81", "pending", "message-82", "message-83"],
    )
  })

  test(`${status}不影响完整本地页，也不能冒充缺失的正式消息`, () => {
    const pending = { ...messages(90)[0], id: "pending", deliveryStatus: status }
    const full = messages(...range(81, 100))
    assert.equal(
      isCompleteLocalPage(
        [...full, pending].sort((a, b) => a.seq - b.seq),
        101,
      ),
      true,
    )
    assert.equal(
      isCompleteLocalPage(
        full.map((message) => (message.seq === 90 ? pending : message)),
        101,
      ),
      false,
    )
  })

  test(`${status}的估计序号不创建或填平历史缺口`, () => {
    const pending = { ...messages(151)[0], id: "pending", deliveryStatus: status }
    assert.deepEqual(mergeLocalMessageWindows([...messages(50), pending], messages(101)).gap, {
      afterSeq: 50,
      beforeSeq: 101,
    })
    assert.deepEqual(
      advanceLocalMessageGap({ afterSeq: 50, beforeSeq: 151 }, [
        ...messages(...range(51, 100)),
        pending,
      ]),
      { afterSeq: 100, beforeSeq: 151 },
    )
  })
}

function messages(...sequences: number[]) {
  return sequences.map(
    (seq) =>
      ({
        id: `message-${seq}`,
        seq,
        createdAt: "2026-01-01T00:00:00Z",
      }) as DesktopMessage,
  )
}

function range(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}
