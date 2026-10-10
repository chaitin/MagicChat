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
const { mergeLocalMessageWindows } = await import("../src/shared/message-window.ts")
const { boundMessageWindow } =
  await import("../src/renderer/features/chat/bounded-message-window.ts")

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
