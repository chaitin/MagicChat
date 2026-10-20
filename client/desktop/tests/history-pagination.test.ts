import assert from "node:assert/strict"
import test from "node:test"
import type { DesktopMessage } from "../src/shared/account-data"
import {
  hasEarlierMessages,
  mergeRefreshedMessages,
} from "../src/renderer/features/chat/bounded-message-window.ts"

function messages(start: number, end: number): DesktopMessage[] {
  return Array.from({ length: end - start + 1 }, (_, index) => ({
    id: `m${start + index}`,
    seq: start + index,
    createdAt: "2026-01-01T00:00:00Z",
  })) as DesktopMessage[]
}

test("刷新结果晚于历史分页返回时保留已加载历史", () => {
  const refreshed = messages(51, 100)
  const history = messages(31, 100)
  const result = mergeRefreshedMessages(history, refreshed, false)
  assert.equal(result.messages[0].seq, 31)
  assert.equal(result.messages.at(-1)?.seq, 100)
})

test("先刷新再加载历史与先加载历史再刷新保留相同消息", () => {
  const current = messages(51, 100)
  const incoming = messages(51, 101)
  const older = messages(31, 50)
  const refreshFirst = mergeRefreshedMessages(current, incoming, false).messages
  const historyFirst = [...older, ...current]
  assert.deepEqual(mergeRefreshedMessages(historyFirst, incoming, false).messages, [
    ...older,
    ...refreshFirst,
  ])
})

test("刷新保留历史的同时应用已有消息的更新", () => {
  const incoming = messages(51, 100)
  incoming[0] = { ...incoming[0], content: "updated" }
  const result = mergeRefreshedMessages(messages(31, 100), incoming, false)
  assert.equal(result.messages.find((message) => message.seq === 51)?.content, "updated")
  assert.equal(result.messages[0].seq, 31)
})

test("浏览历史时超出窗口上限裁剪尾部而非正在查看的历史", () => {
  const result = mergeRefreshedMessages(messages(1, 200), messages(151, 210), false)
  assert.equal(result.messages.length, 200)
  assert.equal(result.messages[0].seq, 1)
  assert.equal(result.removedAfter, true)
  const latest = mergeRefreshedMessages(messages(1, 200), messages(151, 210), true)
  assert.equal(latest.messages.at(-1)?.seq, 210)
  assert.equal(latest.removedBefore, true)
})

test("话题源消息不变仍能识别历史分页进展", () => {
  const source = { id: "source", seq: 0, virtualType: "topic_source" } as DesktopMessage
  assert.equal(
    hasEarlierMessages([source, ...messages(51, 100)], [source, ...messages(31, 100)]),
    true,
  )
})

test("重复页及只有虚拟消息变化不算历史分页进展", () => {
  const current = messages(51, 100)
  assert.equal(hasEarlierMessages(current, messages(51, 100)), false)
  assert.equal(
    hasEarlierMessages(current, [
      { id: "source", seq: 0, virtualType: "topic_source" } as DesktopMessage,
      ...current,
    ]),
    false,
  )
})
