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

const message = (conversationId: string, seq: number) => ({
  conversationId,
  id: `m${seq}`,
  seq,
  createdAt: "2026-01-01T00:00:00Z",
  senderId: "user",
  senderType: "user" as const,
  senderName: "",
  bodyType: "text",
  content: "hello",
  clientMessageId: "",
  deliveryStatus: "",
  payload: { id: `m${seq}` },
})

test("desktop skips unchanged and large gaps, and fetches a large gap only when opened", async () => {
  const database = new AccountDatabase(":memory:")
  try {
    const stored = (id: string, seq: number) => ({
      id,
      type: "group",
      name: id,
      memberCount: 2,
      avatar: "",
      avatarType: "group",
      avatarId: id,
      createdAt: "2026-01-01T00:00:00Z",
      lastMessageAt: null,
      lastMessageSummary: "",
      pinned: false,
      notificationMuted: false,
      isBuiltinAssistant: false,
      unreadCount: 0,
      lastMessageSeq: seq,
      payload: {},
    })
    database.upsertCurrentConversations([
      stored("same", 5),
      stored("changed", 0),
      stored("large", 0),
    ] as never)
    database.commitSyncedMessages("same", [message("same", 5) as never], 5)
    const requests: string[] = []
    const client = {
      get: async (url: string) => {
        requests.push(url)
        if (url === "/api/client/conversations")
          return {
            conversations: [
              {
                id: "same",
                type: "group",
                name: "same",
                created_at: "2026-01-01T00:00:00Z",
                last_message_seq: 5,
              },
              {
                id: "changed",
                type: "group",
                name: "changed",
                created_at: "2026-01-01T00:00:00Z",
                last_message_seq: 1,
              },
              {
                id: "large",
                type: "group",
                name: "large",
                created_at: "2026-01-01T00:00:00Z",
                last_message_seq: 200,
              },
            ],
          }
        if (url.includes("/changed/messages"))
          return {
            messages: [
              {
                id: "m1",
                conversation_id: "changed",
                seq: 1,
                created_at: "2026-01-01T00:00:00Z",
                sender: { id: "user", type: "user" },
                body: { type: "text", content: "hello" },
              },
            ],
            page: { has_more_before: false, has_more_after: false },
          }
        if (url.includes("/large/messages"))
          return { messages: [], page: { has_more_before: false, has_more_after: false } }
        throw new Error(`unexpected request: ${url}`)
      },
    }
    const manager = new ConversationManager(
      database,
      client as never,
      "user",
      "user",
      () => undefined,
    )
    await manager.refresh()
    assert.deepEqual(
      requests.filter((url) => url.includes("/messages")),
      ["/api/client/conversations/changed/messages?limit=20"],
    )
    assert.equal(database.getMessageSyncSeq("changed"), 1)
    assert.equal(database.getMessageSyncSeq("large"), 0)
    await manager.refresh()
    assert.equal(requests.filter((url) => url.includes("/messages")).length, 1)
    await manager.ensureLatestOnOpen("large")
    assert.equal(requests.filter((url) => url.includes("/large/messages")).length, 1)
  } finally {
    database.close()
  }
})

test("desktop catches up all missing messages through 20-item pages", async () => {
  const database = new AccountDatabase(":memory:")
  try {
    database.upsertCurrentConversations([
      {
        id: "chat",
        type: "group",
        name: "chat",
        memberCount: 2,
        avatar: "",
        avatarType: "group",
        avatarId: "chat",
        createdAt: "2026-01-01T00:00:00Z",
        lastMessageAt: null,
        lastMessageSummary: "",
        pinned: false,
        notificationMuted: false,
        isBuiltinAssistant: false,
        unreadCount: 0,
        lastMessageSeq: 20,
        payload: {},
      } as never,
    ])
    database.commitSyncedMessages("chat", [message("chat", 20) as never], 20)
    const pages: number[] = []
    const manager = new ConversationManager(
      database,
      {
        get: async (url: string) => {
          if (url === "/api/client/conversations")
            return {
              conversations: [
                {
                  id: "chat",
                  type: "group",
                  name: "chat",
                  created_at: "2026-01-01T00:00:00Z",
                  last_message_seq: 61,
                },
              ],
            }
          const seq = Number(new URL(url, "http://example.test").searchParams.get("after_seq"))
          pages.push(seq)
          const end = Math.min(seq + 20, 61)
          return {
            messages: Array.from({ length: end - seq }, (_, i) => ({
              id: `m${seq + i + 1}`,
              conversation_id: "chat",
              seq: seq + i + 1,
              created_at: "2026-01-01T00:00:00Z",
              sender: { id: "user", type: "user" },
              body: { type: "text", content: "hello" },
            })),
            page: { has_more_before: true, has_more_after: end < 61 },
          }
        },
      } as never,
      "user",
      "user",
      () => undefined,
    )
    await manager.refresh()
    assert.deepEqual(pages, [20, 40, 60])
    assert.equal(database.getMessageSyncSeq("chat"), 61)
  } finally {
    database.close()
  }
})

test("desktop stores messages and sync cursor together and never rewinds the cursor", () => {
  const database = new AccountDatabase(":memory:")
  try {
    database.upsertCurrentConversations([
      {
        id: "conversation",
        type: "direct",
        name: "conversation",
        memberCount: 2,
        avatar: "",
        avatarType: "user",
        avatarId: "conversation",
        createdAt: "2026-01-01T00:00:00Z",
        lastMessageAt: null,
        lastMessageSummary: "",
        pinned: false,
        notificationMuted: false,
        isBuiltinAssistant: false,
        unreadCount: 0,
        payload: {},
      } as never,
    ])
    assert.equal(database.getMessageSyncSeq("conversation"), 0)
    database.commitSyncedMessages("conversation", [message("conversation", 12) as never], 12)
    assert.equal(database.getMessageSyncSeq("conversation"), 12)
    database.commitSyncedMessages("conversation", [message("conversation", 11) as never], 11)
    assert.equal(database.getMessageSyncSeq("conversation"), 12)
    assert.throws(() =>
      database.commitSyncedMessages("missing", [message("missing", 50) as never], 50),
    )
    assert.equal(database.getMessageSyncSeq("missing"), 0)
  } finally {
    database.close()
  }
})
