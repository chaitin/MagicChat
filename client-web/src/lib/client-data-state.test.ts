import { describe, expect, it } from "vitest"

import type { ClientConversation, ClientMessage } from "@/lib/client-data-api"
import {
  clearConversationRemovalState,
  compactConversationMessageState,
  createConversationMessageState,
  isConversationTopicVisibleInList,
  isLatestConversationSnapshot,
  mergeBootstrapConversationMessageStates,
  mergeConversationMessages,
  mergeConversationSnapshot,
  mergeLatestCachedMessages,
  orderConversations,
  shouldReplaceConversationSnapshot,
} from "@/lib/client-data-state"

describe("compactConversationMessageState", () => {
  it("keeps the newest messages and preserves the older-page boundary", () => {
    const messages = Array.from({ length: 305 }, (_, index) =>
      createMessage(`message-${index + 1}`, index + 1)
    )
    const state = {
      ...createConversationMessageState(),
      loaded: true,
      messages,
      page: {
        hasMoreAfter: false,
        hasMoreBefore: false,
        limit: 20,
        newestSeq: 305,
        oldestSeq: 1,
      },
    }

    const compacted = compactConversationMessageState(state)

    expect(compacted.messages).toHaveLength(300)
    expect(compacted.messages[0].seq).toBe(6)
    expect(compacted.messages.at(-1)?.seq).toBe(305)
    expect(compacted.page).toEqual({
      hasMoreAfter: false,
      hasMoreBefore: true,
      limit: 20,
      newestSeq: 305,
      oldestSeq: 6,
    })
  })

  it("keeps the same state when it is already within the limit", () => {
    const state = {
      ...createConversationMessageState(),
      messages: [createMessage("message-1", 1)],
    }

    expect(compactConversationMessageState(state)).toBe(state)
  })
})

describe("mergeBootstrapConversationMessageStates", () => {
  it("retains loaded and in-flight windows when the same account bootstraps again", () => {
    const retained = {
      ...createConversationMessageState(),
      loaded: true,
      messages: [createMessage("retained-message", 10)],
    }
    const loading = {
      ...createConversationMessageState(),
      loading: true,
    }
    const preloaded = {
      ...createConversationMessageState(),
      loaded: true,
      messages: [createMessage("preloaded-message", 20)],
    }

    const result = mergeBootstrapConversationMessageStates(
      { loading, retained },
      { preloaded },
      false
    )

    expect(result).toEqual({ loading, preloaded, retained })
    expect(result.retained).toBe(retained)
    expect(result.loading).toBe(loading)
  })

  it("drops the previous account's message windows", () => {
    const previous = {
      ...createConversationMessageState(),
      loaded: true,
      messages: [createMessage("previous-message", 10)],
    }
    const preloaded = {
      ...createConversationMessageState(),
      loaded: true,
      messages: [createMessage("next-message", 20)],
    }

    expect(
      mergeBootstrapConversationMessageStates(
        { previous },
        { preloaded },
        true
      )
    ).toEqual({ preloaded })
  })
})

describe("mergeLatestCachedMessages", () => {
  it("accepts an authoritative update for the same message sequence", () => {
    const current = createMessage("message-10", 10, "原内容")
    const revoked = {
      ...createMessage("message-10", 10),
      body: { type: "revoked" as const },
    }

    expect(
      mergeLatestCachedMessages(
        { "conversation-1": current },
        { "conversation-1": revoked }
      )
    ).toEqual({ "conversation-1": revoked })
  })

  it("does not replace a newer cached message with an older preload", () => {
    const current = createMessage("message-11", 11)
    const stale = createMessage("message-10", 10)

    expect(
      mergeLatestCachedMessages(
        { "conversation-1": current },
        { "conversation-1": stale }
      )
    ).toEqual({ "conversation-1": current })
  })

  it("does not restore a revoked cache entry from a stale same-seq preload", () => {
    const revoked = {
      ...createMessage("message-10", 10),
      body: { type: "revoked" as const },
    }
    const stale = createMessage("message-10", 10, "撤回前内容")

    expect(
      mergeLatestCachedMessages(
        { "conversation-1": revoked },
        { "conversation-1": stale }
      )
    ).toEqual({ "conversation-1": revoked })
  })
})

describe("mergeConversationSnapshot", () => {
  it("merges server updates and additions while retaining omitted local rows", () => {
    const retained = createConversation("retained", "direct", "2026-07-01")
    const oldShared = createConversation("shared", "direct", "2026-07-02")
    const newShared = { ...oldShared, name: "server name" }
    const added = createConversation("added", "direct", "2026-07-03")
    const result = mergeConversationSnapshot(
      [retained, oldShared],
      [newShared, added]
    )
    expect(result.find(({ id }) => id === "shared")).toBe(newShared)
    expect(new Set(result.map(({ id }) => id))).toEqual(
      new Set(["retained", "shared", "added"])
    )
  })

  it("keeps a newly opened direct conversation from an older snapshot", () => {
    const opened = createConversation("new-direct", "direct", "2026-07-03")
    expect(mergeConversationSnapshot([opened], [])).toContain(opened)
  })

  it("does not resurrect an explicitly removed conversation until restored", () => {
    const removed = createConversation("removed", "direct", "2026-07-03")
    const removedIds = new Set([removed.id])
    expect(mergeConversationSnapshot([], [removed], removedIds)).toEqual([])
    removedIds.delete(removed.id)
    expect(mergeConversationSnapshot([], [removed], removedIds)).toContain(
      removed
    )
  })

  it("accepts only the latest concurrent snapshot response", () => {
    expect(isLatestConversationSnapshot(1, 2)).toBe(false)
    expect(isLatestConversationSnapshot(2, 2)).toBe(true)
  })

  it("clears account-scoped removed IDs and cached conversations", () => {
    const conversation = createConversation("removed", "direct", "2026-07-03")
    const removedIds = new Set([conversation.id])
    const removedConversations = new Map([[conversation.id, conversation]])
    clearConversationRemovalState(removedIds, removedConversations)
    expect(removedIds.size).toBe(0)
    expect(removedConversations.size).toBe(0)
  })

  it("replaces snapshots across accounts but merges for the same account", () => {
    expect(shouldReplaceConversationSnapshot("user-a", "user-b")).toBe(true)
    expect(shouldReplaceConversationSnapshot("user-a", "user-a")).toBe(false)
    expect(shouldReplaceConversationSnapshot(null, "user-a")).toBe(true)
  })
})

describe("mergeConversationMessages", () => {
  it("appends newer messages in sequence order", () => {
    const current = [createMessage("message-1", 1)]
    const next = [createMessage("message-3", 3), createMessage("message-2", 2)]

    expect(
      mergeConversationMessages(current, next).map(({ id }) => id)
    ).toEqual(["message-1", "message-2", "message-3"])
  })

  it("prepends an older page in sequence order", () => {
    const current = [
      createMessage("message-3", 3),
      createMessage("message-4", 4),
    ]
    const next = [createMessage("message-2", 2), createMessage("message-1", 1)]

    expect(
      mergeConversationMessages(current, next).map(({ id }) => id)
    ).toEqual(["message-1", "message-2", "message-3", "message-4"])
  })

  it("replaces an existing message with its newest representation", () => {
    const current = [createMessage("message-1", 1, "旧内容")]
    const updated = createMessage("message-1", 1, "新内容")

    expect(mergeConversationMessages(current, [updated])).toEqual([updated])
  })

  it("replaces an optimistic message by client message id", () => {
    const optimistic = {
      ...createMessage("optimistic:client-1", 2),
      clientMessageId: "client-1",
      deliveryStatus: "sending" as const,
    }
    const persisted = {
      ...createMessage("message-2", 2),
      clientMessageId: "client-1",
    }

    expect(mergeConversationMessages([optimistic], [persisted])).toEqual([
      persisted,
    ])
  })

  it("does not downgrade a realtime persisted message on a late HTTP failure", () => {
    const persisted = {
      ...createMessage("message-2", 2),
      clientMessageId: "client-1",
    }
    const lateFailure = {
      ...createMessage("optimistic:client-1", 2),
      clientMessageId: "client-1",
      deliveryStatus: "failed" as const,
    }

    expect(mergeConversationMessages([persisted], [lateFailure])).toEqual([
      persisted,
    ])
  })

  it("deduplicates messages within an incoming page", () => {
    const first = createMessage("message-1", 1, "旧内容")
    const latest = createMessage("message-1", 1, "新内容")

    expect(mergeConversationMessages([], [first, latest])).toEqual([latest])
  })

  it("falls back to a full merge for overlapping sequence ranges", () => {
    const current = [
      createMessage("message-1", 1),
      createMessage("message-3", 3),
    ]
    const next = [createMessage("message-4", 4), createMessage("message-2", 2)]

    expect(
      mergeConversationMessages(current, next).map(({ id }) => id)
    ).toEqual(["message-1", "message-2", "message-3", "message-4"])
  })

  it("uses creation time to order messages with the same sequence", () => {
    const later = createMessage("message-2", 1, "", "2026-07-14T10:01:00Z")
    const earlier = createMessage("message-1", 1, "", "2026-07-14T10:00:00Z")

    expect(
      mergeConversationMessages([later], [earlier]).map(({ id }) => id)
    ).toEqual(["message-1", "message-2"])
  })
})

describe("orderConversations", () => {
  it("pins only the built-in assistant and orders every other conversation by activity", () => {
    const assistant = createConversation("assistant", "app", "2026-07-01", [
      createAppMember("00000000-0000-0000-0000-000000000001"),
    ])
    const regularApp = createConversation("regular-app", "app", "2026-07-18")
    const activeGroup = createConversation(
      "active-group",
      "group",
      "2026-07-20"
    )
    const direct = createConversation("direct", "direct", "2026-07-19")

    expect(
      orderConversations([regularApp, assistant, direct, activeGroup]).map(
        ({ id }) => id
      )
    ).toEqual(["assistant", "active-group", "direct", "regular-app"])
  })

  it("does not pin a group that contains the built-in assistant", () => {
    const recentApp = createConversation("recent-app", "app", "2026-07-20")
    const oldGroup = createConversation("old-group", "group", "2026-07-01", [
      createAppMember("00000000-0000-0000-0000-000000000001"),
    ])

    expect(
      orderConversations([oldGroup, recentApp]).map(({ id }) => id)
    ).toEqual(["recent-app", "old-group"])
  })

  it("orders pinned conversations by activity ahead of unpinned conversations", () => {
    const assistant = createConversation("assistant", "app", "2026-07-01", [
      createAppMember("00000000-0000-0000-0000-000000000001"),
    ])
    const olderPinned = {
      ...createConversation("older-pinned", "group", "2026-07-18"),
      pinned: true,
    }
    const recentPinned = {
      ...createConversation("recent-pinned", "direct", "2026-07-19"),
      pinned: true,
    }
    const newestUnpinned = createConversation(
      "newest-unpinned",
      "group",
      "2026-07-20"
    )

    expect(
      orderConversations([
        newestUnpinned,
        olderPinned,
        assistant,
        recentPinned,
      ]).map(({ id }) => id)
    ).toEqual(["assistant", "recent-pinned", "older-pinned", "newest-unpinned"])
  })

  it("keeps topics under their parent and orders the group by topic activity", () => {
    const now = Date.parse("2026-07-27T08:00:00Z")
    const activeParent = createConversation(
      "active-parent",
      "group",
      "2026-07-27"
    )
    activeParent.lastMessageAt = "2026-07-27T06:00:00Z"
    const recentParent = createConversation(
      "recent-parent",
      "group",
      "2026-07-27"
    )
    recentParent.lastMessageAt = "2026-07-27T07:53:00Z"
    const newestTopic = createTopicConversation(
      "newest-topic",
      activeParent,
      "2026-07-27T07:55:00Z"
    )
    const olderTopic = createTopicConversation(
      "older-topic",
      activeParent,
      "2026-07-27T07:50:00Z"
    )

    expect(
      orderConversations(
        [recentParent, olderTopic, activeParent, newestTopic],
        now
      ).map(({ id }) => id)
    ).toEqual(["active-parent", "newest-topic", "older-topic", "recent-parent"])
  })

  it("does not let a legacy topic pin move its parent group", () => {
    const now = Date.parse("2026-07-27T08:00:00Z")
    const oldParent = createConversation("old-parent", "group", "2026-07-27")
    oldParent.lastMessageAt = "2026-07-27T07:30:00Z"
    const recentParent = createConversation(
      "recent-parent",
      "group",
      "2026-07-27"
    )
    recentParent.lastMessageAt = "2026-07-27T07:55:00Z"
    const pinnedTopic = {
      ...createTopicConversation(
        "pinned-topic",
        oldParent,
        "2026-07-27T07:40:00Z"
      ),
      pinned: true,
    }

    expect(
      orderConversations([oldParent, pinnedTopic, recentParent], now).map(
        ({ id }) => id
      )
    ).toEqual(["recent-parent", "old-parent", "pinned-topic"])
  })
})

describe("isConversationTopicVisibleInList", () => {
  const now = Date.parse("2026-07-27T08:00:00Z")
  const parent = createConversation("parent", "group", "2026-07-27")

  it("hides inactive read topics but keeps unread and active topics", () => {
    const stale = createTopicConversation(
      "stale",
      parent,
      "2026-07-27T07:29:59Z"
    )
    const unread = { ...stale, id: "unread", lastMessageSeq: 2, unreadCount: 1 }

    expect(isConversationTopicVisibleInList(stale, { now })).toBe(false)
    expect(isConversationTopicVisibleInList(unread, { now })).toBe(true)
    expect(
      isConversationTopicVisibleInList(stale, {
        activeConversationId: stale.id,
        now,
      })
    ).toBe(true)
  })

  it("never shows archived or non-participating topics", () => {
    const topic = createTopicConversation(
      "topic",
      parent,
      "2026-07-27T07:55:00Z"
    )

    expect(
      isConversationTopicVisibleInList({
        ...topic,
        topic: { ...topic.topic!, archived: true },
      })
    ).toBe(false)
    expect(
      isConversationTopicVisibleInList({
        ...topic,
        topic: { ...topic.topic!, participating: false },
      })
    ).toBe(false)
  })
})

function createMessage(
  id: string,
  seq: number,
  content = id,
  createdAt = `2026-07-14T10:00:${String(seq).padStart(2, "0")}Z`
): ClientMessage {
  return {
    body: { content, type: "text" },
    clientMessageId: `client-${id}`,
    conversationId: "conversation-1",
    createdAt,
    id,
    reactionVersion: 0,
    reactions: [],
    sender: { id: "user-1", type: "user" },
    seq,
  }
}

function createConversation(
  id: string,
  type: ClientConversation["type"],
  activityDate: string,
  members?: ClientConversation["members"]
): ClientConversation {
  return {
    avatar: "",
    createdAt: `${activityDate}T08:00:00Z`,
    id,
    lastMessageAt: `${activityDate}T09:00:00Z`,
    lastMessageId: `message-${id}`,
    lastMessageSeq: 1,
    lastMessageSender: null,
    lastMessageSummary: id,
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 1,
    memberCount: members?.length ?? 2,
    members,
    name: id,
    type,
    unreadCount: 0,
    visibility: "private",
  }
}

function createTopicConversation(
  id: string,
  parent: ClientConversation,
  lastMessageAt: string
): ClientConversation {
  return {
    ...createConversation(id, "topic", "2026-07-27"),
    lastMessageAt,
    topic: {
      archived: false,
      parentConversationId: parent.id,
      parentConversationName: parent.name,
      parentConversationType: parent.type === "topic" ? "group" : parent.type,
      participating: true,
      sourceMessageId: `source-${id}`,
      sourceMessageSeq: 1,
      sourceSender: {
        avatar: "",
        id: "user-1",
        name: "User",
        type: "user",
      },
    },
  }
}

function createAppMember(id: string) {
  return {
    avatar: "",
    email: "",
    id,
    name: "App",
    nickname: "",
    phone: "",
    role: "member" as const,
    type: "app" as const,
  }
}
