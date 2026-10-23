import assert from "node:assert/strict"
import test from "node:test"
import type { DesktopMessage, DesktopMessageBody } from "../src/shared/account-data.ts"
import { mergeLocalMessageWindows } from "../src/shared/message-window.ts"
import {
  mergeRefreshedMessages,
  retainMessageWindow,
} from "../src/renderer/features/chat/bounded-message-window.ts"

const bodies: DesktopMessageBody[] = [
  { type: "text", content: "hello" },
  { type: "markdown", content: "**hello**" },
  { type: "link", title: "Test", url: "https://example.test" },
  { type: "file", fileId: "file", name: "test.txt", sizeBytes: 1 },
  { type: "image", fileId: "image", width: 256, height: 256 },
  { type: "video", fileId: "video", name: "test.mp4", sizeBytes: 1, contentType: "video/mp4" },
]

for (const body of bodies) {
  for (const deliveryStatus of ["sending", "failed"] as const) {
    for (const reversed of [false, true]) {
      test(`${body.type} ${deliveryStatus} 与确认消息合并仅保留正式项，确认先到=${reversed}`, () => {
        const pending = message({
          id: "optimistic:request",
          deliveryStatus,
          bodyType: body.type,
          body: "fileId" in body ? { ...body, fileId: "local-cache" } : body,
        })
        const confirmed = message({ id: "server", bodyType: body.type, body })
        const current = reversed ? [confirmed] : [pending]
        const incoming = reversed ? [pending] : [confirmed]
        assert.deepEqual(mergeLocalMessageWindows(current, incoming).messages, [confirmed])
        assert.deepEqual(retainMessageWindow(incoming, current), [confirmed])
        for (const atBottom of [true, false]) {
          assert.deepEqual(mergeRefreshedMessages(current, incoming, atBottom).messages, [
            confirmed,
          ])
        }
      })
    }
  }
}

test("已残留两条的窗口在下一次刷新时自动清理，不需要删除数据库记录", () => {
  const pending = message({ id: "optimistic:request", deliveryStatus: "sending" })
  const confirmed = message({ id: "server" })
  assert.deepEqual(mergeRefreshedMessages([pending, confirmed], [], true).messages, [confirmed])
  assert.deepEqual(mergeLocalMessageWindows([], [confirmed, pending]).messages, [confirmed])
})

test("确认一条消息不会删除其他正在发送或失败的消息", () => {
  const first = message({ id: "optimistic:request", deliveryStatus: "sending" })
  const other = message({
    id: "optimistic:other",
    clientMessageId: "other",
    seq: 3,
    deliveryStatus: "failed",
  })
  const confirmed = message({ id: "server" })
  assert.deepEqual(mergeRefreshedMessages([first, other], [confirmed], true).messages, [
    confirmed,
    other,
  ])
})

test("并发发送的估计序号与确认消息重叠时，不丢失另一条未完成消息", () => {
  const first = message({ id: "optimistic:request", deliveryStatus: "sending", seq: 1 })
  const other = message({
    id: "optimistic:other",
    clientMessageId: "other",
    deliveryStatus: "sending",
    seq: 2,
  })
  const received = message({
    id: "received",
    clientMessageId: "another",
    senderId: "another-user",
    seq: 1,
  })
  const confirmed = message({ id: "server", seq: 2 })
  const result = retainMessageWindow([received, confirmed], [first, other])
  assert.equal(result.length, 3)
  assert.ok(result.includes(other))
  assert.ok(result.includes(confirmed))
  assert.ok(result.includes(received))
})

test("内容和序号相同但请求ID不同的消息，以及无请求ID的消息，仍然分别保留", () => {
  const first = message({ id: "first" })
  const second = message({ id: "second", clientMessageId: "another" })
  const third = message({ id: "third", clientMessageId: "" })
  const fourth = message({ id: "fourth", clientMessageId: "" })
  assert.equal(mergeLocalMessageWindows([first, third], [second, fourth]).messages.length, 4)
})

for (const overrides of [
  { conversationId: "another-room" },
  { senderId: "another-user" },
  { senderType: "app" },
]) {
  test(`相同请求ID但不同会话或发送者不误合并：${JSON.stringify(overrides)}`, () => {
    const first = message({ id: "optimistic:request", deliveryStatus: "sending" })
    const other = message({ id: "another-server", ...overrides })
    assert.equal(mergeLocalMessageWindows([first], [other]).messages.length, 2)
  })
}

test("话题源虚拟消息不参与普通消息请求ID关联", () => {
  const source = message({ id: "topic-source", virtualType: "topic_source", seq: 0 })
  const regular = message({ id: "server" })
  assert.deepEqual(mergeLocalMessageWindows([source], [regular]).messages, [source, regular])
})

test("未确认的相同临时消息仍可更新失败状态并重试", () => {
  const pending = message({ id: "optimistic:request", deliveryStatus: "sending" })
  const failed = { ...pending, deliveryStatus: "failed" as const }
  assert.deepEqual(mergeLocalMessageWindows([pending], [failed]).messages, [failed])
  assert.deepEqual(mergeLocalMessageWindows([failed], [pending]).messages, [pending])
})

test("发送回执到达时保留已加载历史，只替换匹配的临时消息", () => {
  const history = Array.from({ length: 75 }, (_, i) =>
    message({ id: `history-${i + 1}`, seq: i + 1, clientMessageId: "" }),
  )
  const pending = message({ id: "optimistic:request", seq: 76, deliveryStatus: "sending" })
  const confirmed = message({ id: "server", seq: 76 })
  assert.deepEqual(retainMessageWindow([...history.slice(-50), confirmed], [...history, pending]), [
    ...history,
    confirmed,
  ])
})

test("发送确认前插入其他人的消息时按正式序号排序，不丢失消息", () => {
  const history = message({ id: "history", seq: 1, clientMessageId: "" })
  const pending = message({ id: "optimistic:request", deliveryStatus: "sending" })
  const received = message({
    id: "received",
    senderId: "another-user",
    clientMessageId: "another",
    seq: 2,
  })
  const confirmed = message({ id: "server", seq: 3 })
  assert.deepEqual(retainMessageWindow([received, confirmed], [history, pending]), [
    history,
    received,
    confirmed,
  ])
})

test("发送后仍保留话题源消息且总窗口不超过200条", () => {
  const source = message({ id: "source", seq: 0, virtualType: "topic_source" })
  const history = Array.from({ length: 199 }, (_, i) =>
    message({ id: `history-${i + 1}`, seq: i + 1, clientMessageId: "" }),
  )
  const pending = message({ id: "optimistic:request", seq: 200, deliveryStatus: "sending" })
  const confirmed = message({ id: "server", seq: 200 })
  const result = retainMessageWindow([confirmed], [source, ...history, pending])
  assert.equal(result.length, 200)
  assert.equal(result[0], source)
  assert.equal(result[1].seq, 2)
  assert.equal(result.at(-1), confirmed)
})

test("发送响应只保留所属会话，不能合入切换前会话的消息", () => {
  const old = message({ id: "old", conversationId: "old-room", seq: 1 })
  const pending = message({ id: "optimistic:request", deliveryStatus: "sending", seq: 2 })
  assert.deepEqual(retainMessageWindow([pending], [old]), [pending])
  assert.deepEqual(retainMessageWindow([], [old]), [])
})

function message(overrides: Partial<DesktopMessage>): DesktopMessage {
  return {
    id: "server",
    conversationId: "room",
    clientMessageId: "request",
    seq: 2,
    createdAt: "2026-10-22T00:00:00Z",
    senderId: "me",
    senderType: "user",
    senderName: "Me",
    isMine: true,
    bodyType: "text",
    content: "hello",
    body: { type: "text", content: "hello" },
    reactions: [],
    ...overrides,
  }
}
