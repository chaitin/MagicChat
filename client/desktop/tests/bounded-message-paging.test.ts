import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"
import ts from "typescript"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (
        specifier.startsWith(".") &&
        (error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
      )
        return nextResolve(`${specifier}.ts`, context)
      throw error
    }
  },
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context)
    if (!url.endsWith(".ts")) return loaded
    return {
      ...loaded,
      format: "module",
      shortCircuit: true,
      source: ts.transpileModule(String(loaded.source), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    }
  },
})

const { AccountDatabase } = await import("../src/main/account/account-database.ts")
const { ConversationManager } = await import("../src/main/account/conversation-manager.ts")
const { parseConversation, parseMessage } =
  await import("../src/main/account/conversation-parser.ts")
const { mergeLocalMessageWindows } = await import("../src/shared/message-window.ts")
const { boundMessageWindow, hasEarlierMessages, mergeRefreshedMessages, retainMessageWindow } =
  await import("../src/renderer/features/chat/bounded-message-window.ts")

for (const type of ["group", "topic"] as const) {
  test(`${type} 通知可定位最新50条之外的消息并向后分页`, () => {
    const { database, manager } = createTopicFixture()
    const conversationId = type === "group" ? "room" : "topic"
    try {
      assert.equal(
        manager
          .listMessages(conversationId, 50)
          .some((message) => message.id === `${conversationId}-m1`),
        false,
      )
      const context = manager.getLocalMessageContext(conversationId, `${conversationId}-m1`)
      assert.equal(context.messages[0]?.id, `${conversationId}-m1`)
      assert.equal(context.messages.at(-1)?.seq, 21)
      assert.equal(context.hasMoreBefore, false)
      assert.equal(context.hasMoreAfter, true)
      const next = manager.listLocalMessagesAfter(conversationId, 1)
      assert.equal(next.messages.length, 50)
      assert.equal(next.messages[0]?.seq, 2)
      assert.equal(next.messages.at(-1)?.seq, 51)
      assert.equal(next.hasMoreBefore, true)
      assert.equal(next.hasMoreAfter, true)
    } finally {
      database.close()
    }
  })
}

test("已读且不活跃的话题即使不在侧栏仍可定位消息", () => {
  const { database, manager } = createTopicFixture({ read: true })
  try {
    assert.equal(
      manager.listConversations().some((conversation) => conversation.id === "topic"),
      false,
    )
    assert.equal(manager.getLocalMessageContext("topic", "topic-m1").messages[0]?.id, "topic-m1")
    assert.equal(manager.listLocalMessagesAfter("topic", 79).messages[0]?.id, "topic-m80")
  } finally {
    database.close()
  }
})

test("已打开的只读话题可定位和分页，失去父会话访问后拒绝读取", async () => {
  const { database, manager } = createTopicFixture({ viewOnly: true })
  try {
    assert.equal(database.hasCurrentConversation("topic"), false)
    await manager.openTopicConversation("topic")
    assert.equal(database.hasCurrentConversation("topic"), false)
    assert.equal(manager.getLocalMessageContext("topic", "topic-m1").messages[0]?.id, "topic-m1")
    assert.equal(manager.listLocalMessagesAfter("topic", 79).messages[0]?.id, "topic-m80")
    database.removeCurrentConversation("room")
    assert.throws(() => manager.getLocalMessageContext("topic", "topic-m1"), {
      code: "conversation_not_found",
    })
    assert.throws(() => manager.listLocalMessagesAfter("topic", 1), {
      code: "conversation_not_found",
    })
    await assert.rejects(manager.getConversationInfo("topic"), { code: "conversation_not_found" })
  } finally {
    database.close()
  }
})

test("消息读取校验仍拒绝不存在、已移除或未打开的缓存话题", () => {
  const { database, manager, topicPayload } = createTopicFixture()
  try {
    for (const conversationId of ["missing", "cached"]) {
      if (conversationId === "cached") {
        database.upsertViewedTopic(
          parseConversation({ ...topicPayload, id: conversationId }, "user"),
        )
      }
      assert.throws(() => manager.getLocalMessageContext(conversationId, "topic-m1"), {
        code: "conversation_not_found",
      })
      assert.throws(() => manager.listLocalMessagesAfter(conversationId, 1), {
        code: "conversation_not_found",
      })
    }
    assert.throws(() => manager.getLocalMessageContext("topic", "room-m1"), {
      code: "message_not_found",
    })
    assert.throws(() => manager.getLocalMessageContext("topic", ""), { code: "invalid_message" })
    assert.throws(() => manager.listLocalMessagesAfter("topic", 0), { code: "invalid_message_seq" })
    database.removeCurrentConversation("topic")
    assert.throws(() => manager.getLocalMessageContext("topic", "topic-m1"), {
      code: "conversation_not_found",
    })
    assert.throws(() => manager.listLocalMessagesAfter("topic", 1), {
      code: "conversation_not_found",
    })
  } finally {
    database.close()
  }
})

test("允许话题消息读取不会放开话题列表和附件管理入口", () => {
  const { database, manager } = createTopicFixture()
  try {
    assert.throws(() => manager.listLocalTopics("topic", 0, ""), { code: "conversation_not_found" })
    assert.throws(() => manager.listLocalAttachments("topic", 0, ""), {
      code: "conversation_not_found",
    })
    assert.deepEqual(manager.listLocalAttachments("room", 0, "").items, [])
  } finally {
    database.close()
  }
})

for (const type of ["text", "markdown", "link", "file", "image", "video"] as const) {
  test(`${type} 真实SQLite确认后仅一条消息，刷新和迟到发送结果均不能恢复临时项`, () => {
    const { database, manager } = createTopicFixture()
    try {
      const input = {
        conversationId: "room",
        clientMessageId: `request-${type}`,
        senderId: "user",
        senderName: "User",
      }
      let body: Record<string, unknown>
      if (type === "text" || type === "markdown" || type === "link") {
        const content = type === "link" ? "https://example.test" : "hello"
        database.createOptimisticMessage({ ...input, bodyType: type, content })
        body = type === "link" ? { type, url: content, title: content } : { type, content }
      } else if (type === "file") {
        database.createOptimisticFileMessage({
          ...input,
          filePath: "/not-opened-fixture",
          name: "test.txt",
          sizeBytes: 1,
        })
        body = { type, file_id: "server-file", name: "test.txt", size_bytes: 1 }
      } else if (type === "image") {
        database.createOptimisticImageMessage({
          ...input,
          filePath: "/not-opened-fixture",
          name: "test.webp",
          sizeBytes: 1,
          contentType: "image/webp",
          width: 256,
          height: 256,
          caption: "",
        })
        body = { type, file_id: "server-image", width: 256, height: 256 }
      } else {
        database.createOptimisticVideoMessage({
          ...input,
          filePath: "/not-opened-fixture",
          name: "test.mp4",
          sizeBytes: 1,
          contentType: "video/mp4",
          caption: "",
        })
        body = {
          type,
          file_id: "server-video",
          name: "test.mp4",
          size_bytes: 1,
          content_type: "video/mp4",
        }
      }
      const pending = manager.listMessages("room", 200)
      assert.equal(pending.at(-1)?.deliveryStatus, "sending")
      database.upsertMessages([
        parseMessage(
          {
            id: "server-confirmation",
            conversation_id: "room",
            client_message_id: input.clientMessageId,
            seq: 81,
            created_at: "2026-10-22T00:00:00Z",
            sender: { id: "user", type: "user", name: "User" },
            body,
          },
          "room",
        ),
      ])
      const confirmed = manager.listMessages("room", 200)
      assert.equal(confirmed.length, 81)
      assert.equal(confirmed.at(-1)?.bodyType, type)
      assert.equal(confirmed.at(-1)?.deliveryStatus, undefined)
      assert.deepEqual(mergeRefreshedMessages(pending, confirmed, true).messages, confirmed)
      assert.deepEqual(retainMessageWindow(pending, confirmed), confirmed)
    } finally {
      database.close()
    }
  })
}

function createTopicFixture({ read = false, viewOnly = false } = {}) {
  const database = new AccountDatabase(":memory:")
  const roomPayload = {
    id: "room",
    type: "group",
    name: "Room",
    created_at: "2026-01-01T00:00:00Z",
    last_message_seq: 80,
    unread_count: 80,
  }
  const topicPayload = {
    ...roomPayload,
    id: "topic",
    type: "topic",
    last_read_seq: read ? 80 : 0,
    unread_count: read ? 0 : 80,
    topic: {
      parent_conversation_id: "room",
      participating: !viewOnly,
      archived: viewOnly,
      source_sender: { id: "sender", type: "user", name: "Sender" },
    },
  }
  database.upsertCurrentConversations([
    parseConversation(roomPayload, "user"),
    ...(!viewOnly ? [parseConversation(topicPayload, "user")] : []),
  ])
  if (viewOnly) database.upsertViewedTopic(parseConversation(topicPayload, "user"))
  const messages = ["room", "topic"].flatMap((conversationId) =>
    Array.from({ length: 80 }, (_, index) => ({
      id: `${conversationId}-m${index + 1}`,
      conversation_id: conversationId,
      seq: index + 1,
      created_at: "2026-01-01T00:00:00Z",
      sender: { id: "sender", type: "user", name: "Sender" },
      body: { type: "text", text: "测试消息" },
    })),
  )
  database.upsertMessages(messages.map((message) => parseMessage(message, message.conversation_id)))
  const manager = new ConversationManager(
    database,
    {
      get: async (path: string) => {
        if (path === "/api/client/conversations/topics/topic") {
          return {
            conversation: topicPayload,
            parent_conversation: roomPayload,
            can_participate: false,
          }
        }
        if (path.startsWith("/api/client/conversations/topic/messages?")) {
          return {
            messages: messages.filter((message) => message.conversation_id === "topic"),
            page: { has_more_before: false, has_more_after: false },
          }
        }
        throw new Error(`unexpected network request: ${path}`)
      },
    } as never,
    "user",
    "User",
    () => undefined,
  )
  return { database, manager, topicPayload }
}

function createPendingHistoryFixture({
  status = "failed" as "sending" | "failed",
  cached = true,
  pendingStart = 60,
  pendingCount = 1,
  total = 100,
} = {}) {
  const database = new AccountDatabase(":memory:")
  const records = Array.from({ length: total }, (_, index) => ({
    id: `history-${index + 1}`,
    conversation_id: "room",
    seq: index + 1,
    created_at: index + 1 < pendingStart ? "2026-01-01T00:00:00Z" : "2099-01-01T00:00:00Z",
    sender: { id: "other", type: "user", name: "Other" },
    body: { type: "text", text: "历史消息" },
  }))
  let requests = 0
  database.upsertCurrentConversations([
    parseConversation(
      {
        id: "room",
        type: "group",
        name: "Room",
        created_at: "2026-01-01T00:00:00Z",
        last_message_seq: total,
        unread_count: 0,
      },
      "user",
    ),
  ])
  database.upsertMessages(
    records
      .filter((row) => row.seq < pendingStart && (cached || row.seq >= pendingStart - 10))
      .map((row) => parseMessage(row, "room")),
  )
  const manager = new ConversationManager(
    database,
    {
      get: async (path: string) => {
        requests++
        const before = Number(new URL(path, "https://example.test").searchParams.get("before_seq"))
        const messages = records.filter((row) => row.seq < before).slice(-20)
        return {
          messages,
          page: {
            has_more_before: Boolean(messages[0] && messages[0].seq > 1),
            has_more_after: false,
          },
        }
      },
    } as never,
    "user",
    "User",
    () => {},
  )
  for (let i = 0; i < pendingCount; i++) {
    const clientMessageId = `pending-${i}`
    database.createOptimisticMessage({
      conversationId: "room",
      clientMessageId,
      content: "未确认的消息",
      bodyType: "text",
      senderId: "user",
      senderName: "User",
    })
    if (status === "failed") database.setOutgoingMessageStatus("room", clientMessageId, "failed")
  }
  database.upsertMessages(
    records.filter((row) => row.seq >= pendingStart).map((row) => parseMessage(row, "room")),
  )
  return {
    database,
    manager,
    requests: () => requests,
    close() {
      manager.close()
      database.close()
    },
  }
}

for (const status of ["sending", "failed"] as const) {
  for (const cached of [true, false]) {
    test(`${status}序号重叠：${cached ? "完整本地缓存" : "远端补页"}仍持续加载历史并保留重试项`, async (t) => {
      const f = createPendingHistoryFixture({ status, cached })
      t.after(f.close)
      let current = f.manager.listMessages("room", 50)
      assert.ok(
        current.some((row) => row.clientMessageId === "pending-0" && row.deliveryStatus === status),
      )
      let hasMore = true
      for (let step = 0; hasMore && step < 10; step++) {
        const confirmed = current.filter((row) => !row.deliveryStatus && !row.virtualType)
        const cursor = confirmed[0].seq
        const page = await f.manager.loadBeforeMessages("room", cursor, confirmed.length)
        assert.ok(
          page.messages.filter((row) => !row.deliveryStatus).every((row) => row.seq < cursor),
        )
        const next = boundMessageWindow(
          mergeLocalMessageWindows(page.messages, current).messages,
          "older",
        ).messages
        assert.equal(hasEarlierMessages(current, next), true, "不能再次返回同一个最新尾段")
        assert.ok(
          next.some((row) => row.clientMessageId === "pending-0" && row.deliveryStatus === status),
        )
        current = next
        hasMore = page.hasMoreBefore
      }
      assert.equal(hasMore, false)
      assert.equal(current.find((row) => !row.deliveryStatus && !row.virtualType)?.seq, 1)
      assert.equal(cached ? f.requests() === 0 : f.requests() > 0, true)
    })
  }
}

test("失败记录在新加载页里时不会丢失，也不占正式消息的20条分页配额", async (t) => {
  const f = createPendingHistoryFixture({ pendingStart: 31, pendingCount: 20 })
  t.after(f.close)
  const current = f.manager.listMessages("room", 50)
  assert.equal(current[0].seq, 51)
  const page = await f.manager.loadBeforeMessages("room", 51, 50)
  assert.equal(page.messages.filter((row) => !row.deliveryStatus).length, 20)
  assert.equal(page.messages.filter((row) => row.deliveryStatus === "failed").length, 20)
  assert.equal(f.requests(), 0, "完整正式缓存不应被失败项误判为缺页而访问网络")
  const merged = mergeLocalMessageWindows(page.messages, current).messages
  assert.equal(hasEarlierMessages(current, merged), true)
})

test("200条窗口含失败消息时仍只返回更早页，不因正式计数199而重取最新尾段", async (t) => {
  const f = createPendingHistoryFixture({ pendingStart: 220, total: 250 })
  t.after(f.close)
  const current = f.manager.listMessages("room", 200)
  const confirmed = current.filter((row) => !row.deliveryStatus && !row.virtualType)
  assert.equal(confirmed.length, 199)
  const page = await f.manager.loadBeforeMessages("room", confirmed[0].seq, confirmed.length)
  assert.ok(page.messages.every((row) => row.seq < confirmed[0].seq))
  const next = boundMessageWindow(
    mergeLocalMessageWindows(page.messages, current).messages,
    "older",
  )
  assert.equal(next.messages.length, 200)
  assert.equal(next.removedAfter, true)
  assert.equal(hasEarlierMessages(current, next.messages), true)
  assert.ok(next.messages.some((row) => row.clientMessageId === "pending-0"))
})

test("定位旧消息后仍可继续加载末尾的失败消息以供重试", (t) => {
  const f = createPendingHistoryFixture({ pendingStart: 101 })
  t.after(f.close)
  const context = f.manager.getLocalMessageContext("room", "history-80")
  assert.equal(context.messages.at(-1)?.seq, 100)
  assert.equal(context.hasMoreAfter, true)
  const page = f.manager.listLocalMessagesAfter("room", 100)
  assert.ok(
    page.messages.some(
      (row) => row.clientMessageId === "pending-0" && row.deliveryStatus === "failed",
    ),
  )
})

test("窗口到达 200 条后继续上翻只返回游标之前的消息", async () => {
  const database = new AccountDatabase(":memory:")
  try {
    database.upsertCurrentConversations([
      {
        id: "room",
        type: "group",
        name: "Room",
        memberCount: 2,
        avatar: "",
        avatarType: "group",
        avatarId: "room",
        createdAt: "2026-01-01T00:00:00Z",
        lastMessageAt: null,
        lastMessageSummary: "",
        pinned: false,
        notificationMuted: false,
        isBuiltinAssistant: false,
        unreadCount: 0,
        lastMessageSeq: 250,
        payload: {},
      },
    ] as never)
    database.upsertMessages(
      Array.from({ length: 250 }, (_, index) => ({
        conversationId: "room",
        id: `m${index + 1}`,
        seq: index + 1,
        createdAt: "2026-01-01T00:00:00Z",
        senderId: "user",
        senderType: "user",
        senderName: "User",
        bodyType: "text",
        content: "hello",
        clientMessageId: "",
        deliveryStatus: "",
        payload: { id: `m${index + 1}` },
      })) as never,
    )
    const manager = new ConversationManager(
      database,
      {
        get: () => {
          throw new Error("unexpected network request")
        },
      } as never,
      "user",
      "user",
      () => undefined,
    )
    const latest = manager.listMessages("room", 200)
    assert.equal(latest[0]?.seq, 51)
    const first = await manager.loadBeforeMessages("room", 51, 200)
    assert.equal(first.messages[0]?.seq, 31)
    assert.equal(first.messages.at(-1)?.seq, 50)
    const previousWindow = boundMessageWindow(
      mergeLocalMessageWindows(first.messages, latest).messages,
      "older",
    )
    assert.equal(previousWindow.messages[0]?.seq, 31)
    assert.equal(previousWindow.messages.at(-1)?.seq, 230)
    const second = await manager.loadBeforeMessages("room", 31, 200)
    assert.equal(second.messages[0]?.seq, 11)
    assert.equal(second.messages.at(-1)?.seq, 30)
  } finally {
    database.close()
  }
})
