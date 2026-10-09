import assert from "node:assert/strict"
import test from "node:test"

import {
  publishAllMessageCacheCleared,
  publishConversationMessagesChanged,
  subscribeAllMessageCacheCleared,
  subscribeMessageChanges,
} from "@/data/messages/message-events"

test("message preview events stay within the authenticated account", () => {
  const target = { id: "server", url: "https://example.test", userId: "one" }
  const seen: string[] = []
  const unsubscribe = subscribeMessageChanges(target, (id) => seen.push(id))
  publishConversationMessagesChanged({ ...target, userId: "two" }, "other", { type: "clear" })
  publishConversationMessagesChanged(target, "current", { type: "clear" })
  unsubscribe()
  publishConversationMessagesChanged(target, "after", { type: "clear" })
  assert.deepEqual(seen, ["current"])
})

test("global cache clear notifies active preview subscribers", () => {
  let clears = 0
  const unsubscribe = subscribeAllMessageCacheCleared(() => { clears += 1 })
  publishAllMessageCacheCleared()
  unsubscribe()
  publishAllMessageCacheCleared()
  assert.equal(clears, 1)
})
