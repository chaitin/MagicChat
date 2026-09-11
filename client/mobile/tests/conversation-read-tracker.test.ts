import assert from "node:assert/strict"
import test from "node:test"

import { ConversationReadTracker } from "../src/features/conversation/conversation-read-tracker.ts"

test("deduplicates read requests and advances after confirmation", () => {
  const tracker = new ConversationReadTracker()
  const unread = snapshot({ lastMessageSeq: 8, unreadCount: 2 })

  assert.equal(tracker.nextRequest(unread), 8)
  assert.equal(tracker.nextRequest({ ...unread, unreadCount: 0 }), null)

  tracker.confirm("conversation-1", 8)
  assert.equal(
    tracker.nextRequest({
      ...unread,
      lastMessageSeq: 10,
      newestLoadedSeq: 10,
      unreadCount: 0,
    }),
    10
  )
})

test("retries the latest read request after a failure", () => {
  const tracker = new ConversationReadTracker()
  const unread = snapshot({ lastMessageSeq: 5, unreadCount: 1 })

  assert.equal(tracker.nextRequest(unread), 5)
  tracker.fail("conversation-1", 5)
  assert.equal(tracker.nextRequest(unread), 5)
})

test("does not let an older failure roll back newer progress", () => {
  const tracker = new ConversationReadTracker()

  assert.equal(tracker.nextRequest(snapshot({ lastMessageSeq: 5 })), 5)
  assert.equal(tracker.nextRequest(snapshot({ lastMessageSeq: 9 })), 9)
  tracker.fail("conversation-1", 5)
  assert.equal(tracker.nextRequest(snapshot({ lastMessageSeq: 9 })), null)
})

test("ignores completion from a conversation that is no longer active", () => {
  const tracker = new ConversationReadTracker()

  assert.equal(tracker.nextRequest(snapshot({ lastMessageSeq: 20 })), 20)
  assert.equal(
    tracker.nextRequest(
      snapshot({ conversationId: "conversation-2", lastMessageSeq: 3 })
    ),
    3
  )

  tracker.confirm("conversation-1", 20)
  tracker.fail("conversation-1", 20)
  assert.equal(
    tracker.nextRequest(
      snapshot({ conversationId: "conversation-2", lastMessageSeq: 4 })
    ),
    4
  )
})

test("resets per conversation and observes externally confirmed progress", () => {
  const tracker = new ConversationReadTracker()

  assert.equal(tracker.nextRequest(snapshot({ lastMessageSeq: 5 })), 5)
  assert.equal(
    tracker.nextRequest(
      snapshot({ conversationId: "conversation-2", lastMessageSeq: 3 })
    ),
    3
  )
  assert.equal(
    tracker.nextRequest(
      snapshot({
        conversationId: "conversation-2",
        lastMessageSeq: 6,
        lastReadSeq: 6,
        unreadCount: 0,
      })
    ),
    null
  )
})

function snapshot(
  overrides: Partial<{
    conversationId: string
    lastMessageSeq: number
    lastReadSeq: number
    newestLoadedSeq: number
    unreadCount: number
  }> = {}
) {
  return {
    conversationId: "conversation-1",
    lastMessageSeq: 0,
    lastReadSeq: 0,
    newestLoadedSeq: 0,
    unreadCount: 0,
    ...overrides,
  }
}
