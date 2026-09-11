import assert from "node:assert/strict"
import test from "node:test"

import type {
  ClientConversation,
  ClientMessageList,
} from "../src/core/models.ts"
import type { AuthenticatedTarget } from "../src/core/server-target.ts"
import {
  HISTORY_PRE_SYNC_CONCURRENCY,
  HISTORY_PRE_SYNC_CONVERSATION_LIMIT,
  HISTORY_PRE_SYNC_MESSAGE_LIMIT,
  HISTORY_PRE_SYNC_PAGE_SIZE,
  preSyncConversationHistory,
  preSyncRecentConversationHistory,
  selectHistoryPreSyncConversations,
  type HistoryPreSyncDependencies,
} from "../src/domain/messages/history-pre-sync.ts"

const target: AuthenticatedTarget = {
  id: "server-1",
  url: "https://chat.example.com",
  userId: "user-1",
}

test("selects 20 conversations by pure last activity and counts visible topics", () => {
  const now = Date.parse("2026-08-18T12:00:00Z")
  const conversations = Array.from({ length: 25 }, (_, index) =>
    conversation(`conversation-${index}`, 100 - index)
  )
  conversations[24] = conversation("pinned-old", 1, { pinned: true })
  conversations.push(
    conversation("visible-topic", 101, {
      topic: topic("conversation-0"),
      type: "topic",
    }),
    conversation("hidden-topic", 102, {
      topic: topic("conversation-0", { participating: false }),
      type: "topic",
    })
  )

  const selected = selectHistoryPreSyncConversations(conversations, now)

  assert.equal(selected.length, HISTORY_PRE_SYNC_CONVERSATION_LIMIT)
  assert.equal(selected[0]?.id, "visible-topic")
  assert.equal(selected.some(({ id }) => id === "hidden-topic"), false)
  assert.equal(selected.some(({ id }) => id === "pinned-old"), false)
})

test("limits each conversation to 1000 synchronized messages with pages of at most 20", async () => {
  let syncStateReads = 0
  let synchronizedMessages = 0
  const pageLimits: number[] = []
  const dependencies = dependenciesWith({
    getSyncState: async () => {
      syncStateReads += 1
      return syncStateReads === 1
        ? null
        : syncState({
            hasMoreBefore: true,
            httpSyncedThroughSeq: 2_000,
            oldestCachedSeq: 1_981,
          })
    },
    loadMessagePage: async (_target, _conversationId, input) => {
      pageLimits.push(input.limit)
      synchronizedMessages += input.limit
      const oldestSeq = input.beforeSeq! - input.limit
      return messagePage(input.limit, {
        hasMoreBefore: true,
        newestSeq: input.beforeSeq! - 1,
        oldestSeq,
      })
    },
    synchronizeLatest: async (_target, _conversationId, limit) => {
      pageLimits.push(limit)
      synchronizedMessages += limit
      return messagePage(limit, {
        hasMoreBefore: true,
        newestSeq: 2_000,
        oldestSeq: 1_981,
      })
    },
  })

  await preSyncConversationHistory(
    target,
    conversation("conversation", 1, { lastMessageSeq: 2_000 }),
    dependencies
  )

  assert.equal(synchronizedMessages, HISTORY_PRE_SYNC_MESSAGE_LIMIT)
  assert.equal(Math.max(...pageLimits), HISTORY_PRE_SYNC_PAGE_SIZE)
  assert.equal(pageLimits.length, 50)
})

test("stops at the continuous history boundary captured before synchronization", async () => {
  let catchUpCalls = 0
  let historyCalls = 0
  const dependencies = dependenciesWith({
    catchUpAfter: async (_target, _conversationId, afterSeq, limit) => {
      catchUpCalls += 1
      return {
        committedSeq: 120,
        result: messagePage(limit, {
          hasMoreAfter: false,
          hasMoreBefore: true,
          newestSeq: 120,
          oldestSeq: afterSeq + 1,
        }),
      }
    },
    getSyncState: async () =>
      syncState({
        hasMoreBefore: true,
        httpSyncedThroughSeq: 100,
        oldestCachedSeq: 81,
      }),
    loadMessagePage: async () => {
      historyCalls += 1
      return messagePage(20)
    },
  })

  await preSyncConversationHistory(
    target,
    conversation("conversation", 1, { lastMessageSeq: 120 }),
    dependencies
  )

  assert.equal(catchUpCalls, 1)
  assert.equal(historyCalls, 0)
})

test("retries a page until its third attempt succeeds", async () => {
  let attempts = 0
  const initialized = new Set<string>()
  const dependencies = dependenciesWith({
    getSyncState: async (_target, conversationId) =>
      initialized.has(conversationId)
        ? syncState({
            hasMoreBefore: false,
            httpSyncedThroughSeq: 20,
            oldestCachedSeq: 1,
          })
        : null,
    synchronizeLatest: async (_target, conversationId) => {
      attempts += 1
      if (attempts < 3) throw new Error("temporary failure")
      initialized.add(conversationId)
      return messagePage(20, {
        hasMoreBefore: false,
        newestSeq: 20,
        oldestSeq: 1,
      })
    },
  })

  await preSyncRecentConversationHistory(
    target,
    [conversation("conversation", 1)],
    dependencies
  )

  assert.equal(attempts, 3)
})

test("tries a failed page three times and propagates the failure", async () => {
  const expected = new Error("page failed")
  let attempts = 0
  const dependencies = dependenciesWith({
    getSyncState: async () => null,
    synchronizeLatest: async () => {
      attempts += 1
      throw expected
    },
  })

  await assert.rejects(
    preSyncRecentConversationHistory(
      target,
      [conversation("conversation", 1)],
      dependencies
    ),
    (error: unknown) => error === expected
  )
  assert.equal(attempts, 3)
})

test("runs no more than three conversation synchronization tasks concurrently", async () => {
  let active = 0
  let maximumActive = 0
  const initialized = new Set<string>()
  const dependencies = dependenciesWith({
    getSyncState: async (_target, conversationId) =>
      initialized.has(conversationId)
        ? syncState({
            hasMoreBefore: false,
            httpSyncedThroughSeq: 20,
            oldestCachedSeq: 1,
          })
        : null,
    synchronizeLatest: async (_target, conversationId) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await delay(5)
      initialized.add(conversationId)
      active -= 1
      return messagePage(20, {
        hasMoreBefore: false,
        newestSeq: 20,
        oldestSeq: 1,
      })
    },
  })

  await preSyncRecentConversationHistory(
    target,
    Array.from({ length: 10 }, (_, index) =>
      conversation(`conversation-${index}`, index)
    ),
    dependencies
  )

  assert.equal(maximumActive, HISTORY_PRE_SYNC_CONCURRENCY)
})

function dependenciesWith(
  overrides: Partial<HistoryPreSyncDependencies>
): HistoryPreSyncDependencies {
  return {
    catchUpAfter: async () => {
      throw new Error("unexpected catch-up")
    },
    getSyncState: async () => null,
    loadMessagePage: async () => {
      throw new Error("unexpected history page")
    },
    synchronizeLatest: async () => messagePage(0),
    ...overrides,
  }
}

function conversation(
  id: string,
  activityMinutes: number,
  overrides: Partial<ClientConversation> = {}
): ClientConversation {
  return {
    avatar: "",
    canSend: true,
    createdAt: "2026-08-18T00:00:00Z",
    id,
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastMessageAt: new Date(
      Date.parse("2026-08-18T10:00:00Z") + activityMinutes * 60_000
    ).toISOString(),
    lastMessageId: `${id}-message`,
    lastMessageSender: null,
    lastMessageSeq: 20,
    lastMessageSummary: id,
    lastReadSeq: 20,
    memberCount: 1,
    name: id,
    notificationMuted: false,
    pinned: false,
    type: "group",
    unreadCount: 0,
    visibility: "private",
    ...overrides,
  }
}

function topic(
  parentConversationId: string,
  overrides: Partial<NonNullable<ClientConversation["topic"]>> = {}
): NonNullable<ClientConversation["topic"]> {
  return {
    archived: false,
    parentConversationId,
    parentConversationName: parentConversationId,
    parentConversationType: "group",
    participating: true,
    sourceMessageId: "source-message",
    sourceMessageSeq: 1,
    sourceSender: {
      avatar: "",
      id: "sender",
      name: "Sender",
      type: "user",
    },
    ...overrides,
  }
}

function syncState(
  overrides: Partial<{
    hasMoreBefore: boolean
    httpSyncedThroughSeq: number
    oldestCachedSeq: number | null
  }> = {}
) {
  return {
    hasMoreBefore: false,
    httpSyncedThroughSeq: 0,
    oldestCachedSeq: null,
    ...overrides,
  }
}

function messagePage(
  count: number,
  overrides: Partial<ClientMessageList["page"]> = {}
): ClientMessageList {
  return {
    messages: Array.from({ length: count }, (_, index) => ({
      seq: index + 1,
    })) as ClientMessageList["messages"],
    page: {
      hasMoreAfter: false,
      hasMoreBefore: false,
      limit: count,
      newestSeq: count,
      oldestSeq: count > 0 ? 1 : 0,
      ...overrides,
    },
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
