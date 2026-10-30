import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { runInNewContext } from "node:vm"

import { normalizeClientMessage } from "../src/data/messages/message-normalizer.ts"
import { DATABASE_VERSION } from "../src/data/database/database-version.ts"
import {
  createDatabaseMigrationSQL,
  requiresNormalizedMessageReset,
} from "../src/data/database/migrations.ts"
import {
  applyChoiceMessageTombstone,
  clearConversationMessageTombstones,
  recordChoiceMessageTombstone,
} from "../src/data/messages/message-tombstones.ts"
import type {
  ClientChoiceMessageBody,
  ClientConversation,
  ClientMessage,
  ClientMessageChoiceState,
} from "../src/core/models.ts"
import {
  applyMessageChoiceEvent,
  applyMessageChoiceSnapshot,
  applyMessageChoiceState,
  isMessageChoiceAnswered,
  updateMessageChoiceDraft,
} from "../src/domain/messages/message-choices.ts"
import { preserveNewerMessageState } from "../src/domain/messages/message-reactions.ts"
import {
  formatConversationUnreadDescription,
  getConversationUnreadAlertLabel,
} from "../src/features/messages/conversation-list-model.ts"

const choiceBody: ClientChoiceMessageBody = {
  content: "请选择",
  contentType: "text",
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ],
  selection: "multiple",
  type: "choice",
}

function choiceState(
  responseCount: number,
  myOptionIds: string[] = []
): ClientMessageChoiceState {
  return {
    myOptionIds,
    options: [
      { id: "a", responseCount },
      { id: "b", responseCount: 0 },
      { id: "c", responseCount: 0 },
    ],
    responseCount,
  }
}

function choiceMessage(choice = choiceState(0)): ClientMessage {
  return {
    body: choiceBody,
    choice,
    clientMessageId: "",
    conversationId: "conversation",
    createdAt: "2026-07-28T00:00:00Z",
    id: "message",
    reactionVersion: 0,
    reactions: [],
    sender: { id: "app", type: "app" },
    seq: 1,
  }
}

function conversation(type: ClientConversation["type"]): ClientConversation {
  return {
    avatar: "",
    canSend: true,
    createdAt: "2026-07-28T00:00:00Z",
    id: type,
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastMessageSender: null,
    lastMessageSummary: "",
    lastReadSeq: 0,
    memberCount: 0,
    name: type,
    notificationMuted: false,
    pinned: false,
    type,
    unreadCount: 0,
    visibility: "private",
  }
}

test("choice typography keeps compact option text and 18-point controls without changing other badges", () => {
  function componentStyles(relativePath: string) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8")
    const start = source.indexOf("const styles = StyleSheet.create(")
    assert.notEqual(start, -1)
    return runInNewContext(`${source.slice(start)}\nstyles`, {
      StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    })
  }
  const choice = componentStyles(
    "../src/features/conversation/messages/message-choice.tsx"
  )
  const badge = componentStyles("../src/xgui/components/xgui-badge.tsx")
  assert.equal(choice.optionLabel.fontSize, 12)
  assert.equal(choice.optionLabel.lineHeight, 18)
  assert.equal(choice.optionCount, undefined)
  assert.equal(choice.optionCountText, undefined)
  assert.equal(badge.badge.minHeight, 18)
  assert.equal(badge.badge.minWidth, 18)
  assert.equal(badge.text.fontSize, 12)
  assert.equal(badge.text.lineHeight, 14)
  assert.equal(choice.selectionControl.width, 18)
  assert.equal(choice.selectionControl.height, 18)
  assert.equal(choice.selectionControl.borderRadius, 9)
  assert.equal(choice.radioDot.width, 5)
  assert.equal(choice.radioDot.height, 5)
})

test("normalizes valid choice bodies and legacy null answers", () => {
  const message = normalizeClientMessage({
    body: {
      content: "请选择",
      content_type: "text",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      selection: "single",
      type: "choice",
    },
    choice: {
      my_option_ids: null,
      options: [
        { id: "a", response_count: 0 },
        { id: "b", response_count: 0 },
      ],
      response_count: 0,
    },
    conversation_id: "conversation",
    created_at: "2026-07-28T00:00:00Z",
    id: "message",
    sender: { id: "app", type: "app" },
    seq: 1,
  })

  assert.equal(message.body.type, "choice")
  assert.deepEqual(message.choice?.myOptionIds, [])
})

test("turns invalid choice bodies into unsupported messages", () => {
  const message = normalizeClientMessage({
    body: {
      content: "请选择",
      content_type: "text",
      options: [{ id: "a", label: "A" }],
      selection: "single",
      type: "choice",
    },
    conversation_id: "conversation",
    created_at: "2026-07-28T00:00:00Z",
    id: "message",
    sender: { id: "app", type: "app" },
    seq: 1,
  })
  assert.deepEqual(message.body, { type: "unsupported" })
})

test("rejects invalid state on an otherwise valid choice message", () => {
  assert.throws(() =>
    normalizeClientMessage({
      body: {
        content: "请选择",
        content_type: "text",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        selection: "single",
        type: "choice",
      },
      choice: {
        my_option_ids: [],
        options: [{ id: "a", response_count: -1 }],
        response_count: 0,
      },
      conversation_id: "conversation",
      created_at: "2026-07-28T00:00:00Z",
      id: "message",
      sender: { id: "app", type: "app" },
      seq: 1,
    })
  )

  assert.throws(() =>
    normalizeClientMessage({
      body: {
        content: "请选择",
        content_type: "text",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        selection: "single",
        type: "choice",
      },
      choice: {
        my_option_ids: ["missing"],
        options: [
          { id: "a", response_count: 1 },
          { id: "b", response_count: 0 },
        ],
        response_count: 1,
      },
      conversation_id: "conversation",
      created_at: "2026-07-28T00:00:00Z",
      id: "message",
      sender: { id: "app", type: "app" },
      seq: 1,
    })
  )
})

test("keeps single and multiple drafts in body option order", () => {
  assert.deepEqual(
    updateMessageChoiceDraft({ ...choiceBody, selection: "single" }, [], "b"),
    ["b"]
  )
  assert.deepEqual(updateMessageChoiceDraft(choiceBody, ["c"], "a"), ["a", "c"])
  assert.deepEqual(updateMessageChoiceDraft(choiceBody, ["a", "c"], "c"), ["a"])
  assert.equal(isMessageChoiceAnswered(choiceState(0)), false)
  assert.equal(isMessageChoiceAnswered(choiceState(1, ["a"])), true)
})

test("never regresses counts or replaces a saved answer with empty state", () => {
  const current = choiceMessage(choiceState(3))
  const olderWithAnswer = applyMessageChoiceState(
    current,
    choiceState(2, ["a"])
  )
  assert.equal(olderWithAnswer.choice?.responseCount, 3)
  assert.deepEqual(olderWithAnswer.choice?.myOptionIds, ["a"])

  const newerWithoutAnswer = applyMessageChoiceState(
    olderWithAnswer,
    choiceState(4)
  )
  assert.equal(newerWithoutAnswer.choice?.responseCount, 4)
  assert.deepEqual(newerWithoutAnswer.choice?.myOptionIds, ["a"])

  const mismatched = {
    ...choiceState(5),
    options: [
      { id: "a", responseCount: 5 },
      { id: "b", responseCount: 0 },
      { id: "missing", responseCount: 0 },
    ],
  }
  assert.equal(
    applyMessageChoiceState(newerWithoutAnswer, mismatched),
    newerWithoutAnswer
  )
})

test("uses actor options only for the current user's realtime event", () => {
  const base = choiceMessage(choiceState(1, ["a"]))
  const event = {
    actorOptionIds: ["b"],
    actorUserId: "me",
    choice: choiceState(2),
    conversationId: "conversation",
    messageId: "message",
  }
  assert.deepEqual(
    applyMessageChoiceEvent(base, event, "me").choice?.myOptionIds,
    ["b"]
  )
  assert.deepEqual(
    applyMessageChoiceEvent(base, event, "other").choice?.myOptionIds,
    ["a"]
  )
})

test("applies active, revoked, and deleted reconnect snapshots", () => {
  const base = choiceMessage(choiceState(0))
  const active = applyMessageChoiceSnapshot(base, {
    choice: choiceState(1, ["a"]),
    conversationId: "conversation",
    messageId: "message",
    status: "active",
  })
  assert.deepEqual(active?.choice?.myOptionIds, ["a"])

  const revoked = applyMessageChoiceSnapshot(base, {
    choice: null,
    conversationId: "conversation",
    messageId: "message",
    status: "revoked",
  })
  assert.deepEqual(revoked?.body, { type: "revoked" })
  assert.equal(revoked?.choice, undefined)

  const deleted = applyMessageChoiceSnapshot(base, {
    choice: null,
    conversationId: "conversation",
    messageId: "message",
    status: "deleted",
  })
  assert.equal(deleted, null)
})

test("tombstones block stale HTTP messages from reviving choices", () => {
  const target = {
    id: "server",
    url: "https://example.com",
    userId: "me",
  }
  const active = choiceMessage(choiceState(1, ["a"]))
  recordChoiceMessageTombstone(target, {
    choice: null,
    conversationId: active.conversationId,
    messageId: active.id,
    status: "revoked",
  })
  const revoked = applyChoiceMessageTombstone(target, active)
  assert.deepEqual(revoked?.body, { type: "revoked" })
  assert.deepEqual(preserveNewerMessageState(revoked!, active).body, {
    type: "revoked",
  })

  const deletedMessage = { ...active, id: "deleted" }
  recordChoiceMessageTombstone(target, {
    choice: null,
    conversationId: deletedMessage.conversationId,
    messageId: deletedMessage.id,
    status: "deleted",
  })
  recordChoiceMessageTombstone(target, {
    choice: null,
    conversationId: deletedMessage.conversationId,
    messageId: deletedMessage.id,
    status: "revoked",
  })
  assert.equal(applyChoiceMessageTombstone(target, deletedMessage), null)
  clearConversationMessageTombstones(target, active.conversationId)
})

test("mobile choice options never render response-count badges", () => {
  const choice = readFileSync(new URL(
    "../src/features/conversation/messages/message-choice.tsx",
    import.meta.url
  ), "utf8")
  assert.doesNotMatch(choice, /\b(?:XGUIBadge|responseCount|showResponseCounts?)\b/)
  assert.match(choice, /accessibilityState=\{\{ checked: selected, disabled \}\}/)
  assert.match(choice, /await onRespond\(selectedOptionIds\)/)
  for (const path of [
    "../src/features/conversation/conversation-screen.tsx",
    "../src/features/conversation/messages/message-list.tsx",
    "../src/features/conversation/messages/message-bubble.tsx",
    "../src/features/chat-records/chat-record-screen.tsx",
  ]) {
    assert.doesNotMatch(
      readFileSync(new URL(path, import.meta.url), "utf8"),
      /showChoiceResponseCounts|shouldShowMessageChoiceResponseCounts/
    )
  }
})

test("choice unread wins mention ties and removes duplicate choice prefix", () => {
  const tied = {
    ...conversation("group"),
    lastChoiceSeq: 5,
    lastMentionedSeq: 5,
    lastReadSeq: 4,
  }
  assert.equal(getConversationUnreadAlertLabel(tied), "[选择]")
  assert.equal(
    formatConversationUnreadDescription("张三：[选择] 问题", "[选择]"),
    "张三：问题"
  )
  assert.equal(
    getConversationUnreadAlertLabel({ ...tied, lastMentionedSeq: 6 }),
    "[有人 @ 我]"
  )
})

test("cache v5 preserves normalized message rows while adding conversations", () => {
  assert.equal(DATABASE_VERSION, 7)
  assert.equal(requiresNormalizedMessageReset(3), true)
  assert.equal(requiresNormalizedMessageReset(4), false)

  const database = new DatabaseSync(":memory:")
  try {
    database.exec(createDatabaseMigrationSQL(0))
    database.exec(`
      INSERT INTO cached_messages (
        server_key, user_id, conversation_id, message_id, seq,
        reaction_version, payload_json, created_at, cached_at
      ) VALUES ('server', 'user', 'conversation', 'message', 1, 0,
                '{"body":{"type":"unsupported"}}', 'now', 1);
      INSERT INTO message_sync_state (
        server_key, user_id, conversation_id, last_accessed_at
      ) VALUES ('server', 'user', 'conversation', 1);
    `)

    database.exec(createDatabaseMigrationSQL(4))
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM cached_messages").get()
        ?.count,
      1
    )
    assert.equal(
      database.prepare("SELECT message_count FROM message_cache_stats").get()
        ?.message_count,
      1
    )

    database.exec("PRAGMA user_version = 3")
    database.exec(createDatabaseMigrationSQL(3))
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM cached_messages").get()
        ?.count,
      0
    )
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM message_sync_state").get()
        ?.count,
      0
    )
    assert.equal(
      database.prepare("PRAGMA user_version").get()?.user_version,
      DATABASE_VERSION
    )
  } finally {
    database.close()
  }
})
