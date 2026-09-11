import { describe, expect, it, vi } from "vitest"

import {
  createConversationTopic,
  formatClientMessageBodySummary,
  getConversationTopic,
  listClientConversations,
  listConversationTopics,
  normalizeMessageCreatedEventPayload,
} from "@/lib/client-data-api"

describe("topic client API", () => {
  it("normalizes topic conversations in the conversation list", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          conversations: [topicConversationResponse()],
        },
      })
    )

    const conversations = await listClientConversations(fetcher)

    expect(conversations[0]).toMatchObject({
      id: "topic-1",
      type: "topic",
      topic: {
        archived: false,
        parentConversationId: "parent-1",
        parentConversationName: "产品群",
        parentConversationType: "group",
        participating: true,
        sourceMessageId: "message-1",
        sourceMessageSeq: 8,
        sourceSender: {
          avatar: "/avatars/alice.webp",
          id: "user-1",
          name: "Alice",
          type: "user",
        },
      },
    })
  })

  it("can keep the currently viewed inactive topic in the list", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ success: true, data: { conversations: [] } })
    )

    await listClientConversations(fetcher, {
      includeConversationId: "topic/current",
    })

    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/conversations?include_conversation_id=topic%2Fcurrent",
      { credentials: "include", method: "GET" }
    )
  })

  it("lists all visible topics with status and cursor pagination", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          next_cursor: "cursor-2",
          topics: [topicConversationResponse()],
        },
      })
    )

    const page = await listConversationTopics(
      "parent/1",
      { cursor: "cursor-1", limit: 20, status: "archived" },
      fetcher
    )

    expect(page.nextCursor).toBe("cursor-2")
    expect(page.topics[0]).toMatchObject({ id: "topic-1", type: "topic" })
    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/conversations/parent%2F1/topics?cursor=cursor-1&limit=20&status=archived",
      { credentials: "include", method: "GET" }
    )
  })

  it("creates and loads a topic through the dedicated endpoints", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { conversation: topicConversationResponse(), created: true },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            can_archive: true,
            can_participate: false,
            conversation: topicConversationResponse(),
            parent_conversation: {
              id: "parent-1",
              name: "产品群",
              type: "group",
            },
            source_message: {
              body: { type: "text", content: "讨论发布计划" },
              created_at: "2026-07-20T04:00:00Z",
              id: "message-1",
              revoked_at: null,
              sender: {
                avatar: "/avatars/alice.webp",
                id: "user-1",
                name: "Alice",
                type: "user",
              },
              seq: 8,
              summary: "讨论发布计划",
            },
          },
        })
      )

    const created = await createConversationTopic(
      "parent-1",
      "message-1",
      fetcher
    )
    const detail = await getConversationTopic("topic-1", fetcher)

    expect(created.created).toBe(true)
    expect(detail).toMatchObject({
      canArchive: true,
      canParticipate: false,
      sourceMessage: {
        body: { type: "text", content: "讨论发布计划" },
        id: "message-1",
        sender: { avatar: "/avatars/alice.webp" },
        summary: "讨论发布计划",
      },
    })
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/client/conversations/parent-1/messages/message-1/topic",
      { credentials: "include", method: "POST" }
    )
  })

  it("keeps source-message topic metadata from realtime payloads", () => {
    const message = normalizeMessageCreatedEventPayload({
      message: {
        body: { type: "text", content: "hello" },
        conversation_id: "parent-1",
        created_at: "2026-07-20T04:00:00Z",
        id: "message-1",
        sender: { id: "user-1", type: "user" },
        seq: 8,
        topic: {
          archived: true,
          conversation_id: "topic-1",
          recent_replies: [
            {
              created_at: "2026-07-20T04:10:00Z",
              id: "reply-1",
              sender: { id: "app-1", type: "app" },
              summary: "正在处理",
            },
          ],
        },
      },
    })

    expect(message.topic).toEqual({
      archived: true,
      conversationId: "topic-1",
      recentReplies: [
        {
          createdAt: "2026-07-20T04:10:00Z",
          id: "reply-1",
          sender: { id: "app-1", type: "app" },
          summary: "正在处理",
        },
      ],
    })
  })

  it("normalizes the topic-closed system message", () => {
    const message = normalizeMessageCreatedEventPayload({
      message: {
        body: {
          actor: { display_name: "Alice", id: "user-1" },
          event: "topic_closed",
          type: "system_event",
        },
        conversation_id: "topic-1",
        created_at: "2026-07-20T04:10:00Z",
        id: "message-2",
        sender: { type: "system" },
        seq: 1,
      },
    })

    expect(message.body).toEqual({
      actor: { displayName: "Alice", id: "user-1" },
      event: "topic_closed",
      type: "system_event",
    })
    expect(formatClientMessageBodySummary(message.body)).toBe(
      "Alice 已将话题关闭"
    )
  })
})

function topicConversationResponse() {
  return {
    avatar: "",
    created_at: "2026-07-20T04:00:00Z",
    id: "topic-1",
    name: "讨论发布计划",
    type: "topic",
    topic: {
      archived: false,
      parent_conversation_id: "parent-1",
      parent_conversation_name: "产品群",
      parent_conversation_type: "group",
      participating: true,
      source_message_id: "message-1",
      source_message_seq: 8,
      source_sender: {
        avatar: "/avatars/alice.webp",
        id: "user-1",
        name: "Alice",
        type: "user",
      },
    },
  }
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  })
}
