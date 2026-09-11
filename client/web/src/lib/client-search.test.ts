import { describe, expect, it, vi } from "vitest"

import type {
  ClientConversation,
  ClientMessageSearchResult,
  ContactUser,
} from "@/lib/client-data-api"
import { createClientSearchService } from "@/lib/client-search"

describe("client search service", () => {
  it("combines local and remote results for the all scope", async () => {
    const message = createMessageSearchResult()
    const messageSearch = vi.fn(async () => [message])
    const service = createService(messageSearch)

    const results = await service.search({ keyword: "产品", scope: "all" })

    expect(results.directory).toHaveLength(1)
    expect(results.conversations).toHaveLength(1)
    expect(results.messages).toEqual([message])
    expect(messageSearch).toHaveBeenCalledWith({
      keyword: "产品",
      signal: undefined,
    })
  })

  it("uses only the API provider for the messages scope", async () => {
    const message = createMessageSearchResult()
    const messageSearch = vi.fn(async () => [message])
    const service = createService(messageSearch)
    const controller = new AbortController()

    const results = await service.search(
      { keyword: "产品", scope: "messages" },
      { signal: controller.signal }
    )

    expect(results).toEqual({
      conversations: [],
      directory: [],
      messages: [message],
    })
    expect(messageSearch).toHaveBeenCalledWith({
      keyword: "产品",
      signal: controller.signal,
    })
  })

  it("does not call the message API for a one-character keyword", async () => {
    const messageSearch = vi.fn(async () => [createMessageSearchResult()])
    const service = createService(messageSearch)

    await expect(
      service.search({ keyword: "产", scope: "messages" })
    ).resolves.toEqual({ conversations: [], directory: [], messages: [] })
    expect(messageSearch).not.toHaveBeenCalled()
  })
})

function createService(
  messageSearch: () => Promise<ClientMessageSearchResult[]>
) {
  return createClientSearchService({
    apps: [],
    contacts: [createContact()],
    conversations: [createConversation()],
    currentUserId: "current-user",
    groups: [],
    messageSearch,
  })
}

function createContact(): ContactUser {
  return {
    avatar: "",
    email: "contact@example.com",
    id: "contact-1",
    lastOnlineAt: null,
    name: "产品联系人",
    nickname: "",
    online: true,
    phone: "",
    type: "user",
  }
}

function createConversation(): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-01T00:00:00Z",
    id: "conversation-1",
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSender: null,
    lastMessageSeq: 0,
    lastMessageSummary: "",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 0,
    memberCount: 0,
    members: [],
    name: "产品对话",
    type: "group",
    unreadCount: 0,
    visibility: "private",
  }
}

function createMessageSearchResult(): ClientMessageSearchResult {
  return {
    conversation: {
      avatar: "",
      id: "conversation-1",
      name: "产品对话",
      type: "group",
    },
    message: {
      body: { content: "产品发布计划", type: "text" },
      clientMessageId: "",
      conversationId: "conversation-1",
      createdAt: "2026-07-29T10:00:00Z",
      id: "message-1",
      reactionVersion: 0,
      reactions: [],
      sender: { id: "contact-1", type: "user" },
      seq: 1,
    },
    senderName: "产品经理",
    summary: "产品发布计划",
  }
}
