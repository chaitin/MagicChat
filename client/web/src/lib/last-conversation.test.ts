import { beforeEach, describe, expect, it } from "vitest"

import {
  clearLastConversationId,
  readLastConversationId,
  writeLastConversationId,
} from "@/lib/last-conversation"

describe("last conversation storage", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("stores the last conversation separately for each user", () => {
    expect(writeLastConversationId("user-1", "conversation-1")).toBe(true)
    expect(writeLastConversationId("user-2", "conversation-2")).toBe(true)

    expect(readLastConversationId("user-1")).toBe("conversation-1")
    expect(readLastConversationId("user-2")).toBe("conversation-2")
  })

  it("clears a stored conversation", () => {
    writeLastConversationId("user-1", "conversation-1")

    expect(clearLastConversationId("user-1")).toBe(true)
    expect(readLastConversationId("user-1")).toBe("")
  })

  it("rejects an invalid stored conversation id", () => {
    window.localStorage.setItem(
      "dianbao.chat.last-conversation.v1.user-1",
      "x".repeat(513)
    )

    expect(readLastConversationId("user-1")).toBe("")
    expect(window.localStorage.length).toBe(0)
  })
})
