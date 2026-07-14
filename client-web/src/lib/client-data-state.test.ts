import { describe, expect, it } from "vitest"

import type { ClientMessage } from "@/lib/client-data-api"
import { mergeConversationMessages } from "@/lib/client-data-state"

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
    sender: { id: "user-1", type: "user" },
    seq,
  }
}
