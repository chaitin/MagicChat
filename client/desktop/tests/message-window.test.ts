import assert from "node:assert/strict"
import test from "node:test"
import type { DesktopMessage } from "../src/shared/account-data.ts"
import { contiguousMessageSuffix, isCompleteLocalPage } from "../src/shared/message-window.ts"

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

function messages(...sequences: number[]) {
  return sequences.map((seq) => ({ seq }) as DesktopMessage)
}

function range(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}
