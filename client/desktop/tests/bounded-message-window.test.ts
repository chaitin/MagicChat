import assert from "node:assert/strict"
import test from "node:test"
import type { DesktopMessage } from "../src/shared/account-data.ts"
import {
  boundMessageWindow,
  MAX_VISIBLE_MESSAGES,
  visibleMessageGap,
} from "../src/renderer/features/chat/bounded-message-window.ts"
import {
  captureMessageScroll,
  restoreMessageScroll,
} from "../src/renderer/features/chat/message-scroll-anchor.ts"

const messages = Array.from({ length: 250 }, (_, index) => ({
  id: `message-${index + 1}`,
  seq: index + 1,
})) as DesktopMessage[]

test("消息少于 200 条时不裁剪，窗口初始 50 条不变", () => {
  const initial = messages.slice(-50)
  const result = boundMessageWindow(initial, "newer")
  assert.strictEqual(result.messages, initial)
  assert.equal(result.removedBefore, false)
  assert.equal(result.removedAfter, false)
})

test("向上翻保留最旧 200 条并允许向下重新加载", () => {
  const result = boundMessageWindow(messages, "older")
  assert.equal(result.messages.length, MAX_VISIBLE_MESSAGES)
  assert.equal(result.messages[0].id, "message-1")
  assert.equal(result.messages.at(-1)?.id, "message-200")
  assert.equal(result.removedAfter, true)
  assert.equal(result.removedBefore, false)
})

test("向下翻或收到新消息保留最新 200 条并允许向上重新加载", () => {
  const result = boundMessageWindow(messages, "newer")
  assert.equal(result.messages.length, MAX_VISIBLE_MESSAGES)
  assert.equal(result.messages[0].id, "message-51")
  assert.equal(result.messages.at(-1)?.id, "message-250")
  assert.equal(result.removedBefore, true)
  assert.equal(result.removedAfter, false)
})

test("缺口任一端被裁掉时不展示过期的加载入口", () => {
  const gap = { afterSeq: 48, beforeSeq: 205 }
  assert.deepEqual(visibleMessageGap(gap, messages), gap)
  assert.equal(visibleMessageGap(gap, boundMessageWindow(messages, "older").messages), null)
  assert.equal(visibleMessageGap(gap, boundMessageWindow(messages, "newer").messages), null)
})

function viewport(rows: { id: string; top: number; bottom: number }[], scrollTop: number) {
  const target = {
    scrollTop,
    scrollHeight: 900,
    getBoundingClientRect: () => ({ top: 0, bottom: 300 }),
    querySelectorAll: () =>
      rows.map((row) => ({
        dataset: { messageId: row.id },
        getBoundingClientRect: () => ({ top: row.top, bottom: row.bottom }),
      })),
  }
  return target as unknown as HTMLElement
}

test("前后两端裁剪后按可见消息 ID 保持屏幕位置，不依赖消息高度估算", () => {
  const before = viewport(
    [
      { id: "above", top: -40, bottom: 40 },
      { id: "anchor", top: 40, bottom: 140 },
    ],
    500,
  )
  const snapshot = captureMessageScroll(before)
  assert.equal(snapshot.anchor?.id, "above")
  const afterPrepend = viewport([{ id: "above", top: 160, bottom: 240 }], 500)
  restoreMessageScroll(afterPrepend, snapshot)
  assert.equal(afterPrepend.scrollTop, 700)
  const afterTrimBefore = viewport([{ id: "above", top: -140, bottom: -60 }], 500)
  restoreMessageScroll(afterTrimBefore, snapshot)
  assert.equal(afterTrimBefore.scrollTop, 400)
})
