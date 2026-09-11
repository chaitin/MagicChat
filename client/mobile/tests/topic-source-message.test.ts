import { installTestAccountRuntime } from "./auth-runtime-test-helper.ts"
import assert from "node:assert/strict"
import test from "node:test"

import type { ClientTopicSourceMessage, ClientUser } from "@/core/models"
import { fetchConversationTopic } from "@/data/conversations/conversations-api"
import { buildPresentedTopicSourceMessage } from "@/domain/messages/message-presenter"

const CURRENT_USER: ClientUser = {
  avatar: "/avatars/me.webp",
  createdAt: "2026-08-01T00:00:00Z",
  email: "me@example.com",
  id: "user-me",
  lastOnlineAt: null,
  name: "当前用户",
  nickname: "我",
  phone: "",
  status: "active",
}

test("normalizes the complete source message from topic details", async () => {
  const detail = await fetchConversationTopic(installTestAccountRuntime({ id: "server-1", url: "https://example.com", userId: "user-1" }), "topic-1", {
    fetcher: async () =>
      jsonResponse({
        can_archive: true,
        can_participate: false,
        conversation: {
          created_at: "2026-08-26T00:00:00Z",
          id: "topic-1",
          name: "话题",
          type: "topic",
          topic: {
            archived: false,
            parent_conversation_id: "group-1",
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
        },
        parent_conversation: {
          id: "group-1",
          name: "产品群",
          type: "group",
        },
        source_message: {
          body: { content: "完整来源消息", type: "text" },
          created_at: "2026-08-25T12:00:00Z",
          id: "message-1",
          reply_to: {
            id: "quoted-message",
            sender: { id: "user-me", name: "", type: "user" },
            seq: 7,
            summary: "被引用的消息",
          },
          revoked_at: null,
          sender: {
            avatar: "/avatars/alice.webp",
            id: "user-1",
            name: "Alice",
            type: "user",
          },
          seq: 8,
          summary: "不同的摘要",
        },
      }),
  })

  assert.deepEqual(detail.parentConversation, {
    id: "group-1",
    name: "产品群",
    type: "group",
  })
  assert.deepEqual(detail.sourceMessage.body, {
    content: "完整来源消息",
    type: "text",
  })
  assert.equal(detail.sourceMessage.summary, "不同的摘要")
  assert.equal(detail.sourceMessage.sender.name, "Alice")
  assert.deepEqual(detail.sourceMessage.replyTo, {
    id: "quoted-message",
    sender: { id: "user-me", name: "", type: "user" },
    seq: 7,
    summary: "被引用的消息",
  })
})

test("loads source reply data from the parent conversation for legacy servers", async () => {
  let requests = 0
  const detail = await fetchConversationTopic(installTestAccountRuntime({ id: "server-1", url: "https://example.com", userId: "user-1" }), "topic-1", {
    fetcher: async (input) => {
      requests += 1
      if (String(input).includes("/messages?")) {
        return jsonResponse({
          messages: [
            {
              body: { content: "来源消息", type: "text" },
              conversation_id: "group-1",
              created_at: "2026-08-25T12:00:00Z",
              id: "message-1",
              reply_to: {
                id: "quoted-message",
                sender: { id: "user-2", name: "Bob", type: "user" },
                seq: 7,
                summary: "旧服务端的引用消息",
              },
              sender: { id: "user-1", type: "user" },
              seq: 8,
            },
          ],
          page: {
            has_more_after: false,
            has_more_before: false,
            limit: 1,
            newest_seq: 8,
            oldest_seq: 8,
          },
        })
      }
      return jsonResponse({
        can_archive: true,
        can_participate: false,
        conversation: {
          created_at: "2026-08-26T00:00:00Z",
          id: "topic-1",
          name: "话题",
          type: "topic",
        },
        parent_conversation: { id: "group-1", name: "产品群", type: "group" },
        source_message: {
          body: { content: "来源消息", type: "text" },
          created_at: "2026-08-25T12:00:00Z",
          id: "message-1",
          revoked_at: null,
          sender: { id: "user-1", name: "Alice", type: "user" },
          seq: 8,
          summary: "来源消息",
        },
      })
    },
  })

  assert.equal(requests, 2)
  assert.deepEqual(detail.sourceMessage.replyTo, {
    id: "quoted-message",
    sender: { id: "user-2", name: "Bob", type: "user" },
    seq: 7,
    summary: "旧服务端的引用消息",
  })
})

test("presents a topic source message without revoke capability", () => {
  const sourceMessage: ClientTopicSourceMessage = {
    body: { content: "由我发起的话题", type: "text" },
    createdAt: "2026-08-25T12:00:00Z",
    id: "message-1",
    replyTo: {
      id: "quoted-message",
      sender: { id: "user-1", name: "Alice", type: "user" },
      seq: 7,
      summary: "被引用的消息",
    },
    revokedAt: null,
    sender: {
      avatar: "/avatars/old.webp",
      id: CURRENT_USER.id,
      name: "旧名称",
      type: "user",
    },
    seq: 8,
    summary: "由我发起的话题",
  }

  const presented = buildPresentedTopicSourceMessage({
    contacts: { apps: [], groups: [], users: [] },
    currentUser: CURRENT_USER,
    resolveMentionLabel: () => undefined,
    sourceMessage,
  })

  assert.equal(presented.author, "我")
  assert.equal(presented.avatar, CURRENT_USER.avatar)
  assert.equal(presented.role, "me")
  assert.equal(presented.canRevoke, false)
  assert.deepEqual(presented.body, sourceMessage.body)
  assert.deepEqual(presented.replyTo, {
    author: "Alice",
    summary: "被引用的消息",
  })
})

test("resolves a topic source sender from loaded contacts", () => {
  const presented = buildPresentedTopicSourceMessage({
    contacts: {
      apps: [],
      groups: [],
      users: [
        {
          avatar: "/avatars/alice.webp",
          email: "alice@example.com",
          id: "user-1",
          lastOnlineAt: null,
          name: "Alice",
          nickname: "小艾",
          online: true,
          phone: "",
          type: "user",
        },
      ],
    },
    currentUser: CURRENT_USER,
    fallbackSender: {
      avatar: "/avatars/fallback.webp",
      id: "user-1",
      name: "备用名称",
      type: "user",
    },
    resolveMentionLabel: () => undefined,
    sourceMessage: {
      body: { content: "来源消息", type: "text" },
      createdAt: "2026-08-25T12:00:00Z",
      id: "message-2",
      revokedAt: null,
      sender: { avatar: "", id: "user-1", name: "", type: "user" },
      seq: 9,
      summary: "来源消息",
    },
  })

  assert.equal(presented.author, "小艾")
  assert.equal(presented.avatar, "/avatars/alice.webp")
  assert.equal(presented.role, "other")
})

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ data, success: true }), {
    headers: { "content-type": "application/json" },
    status: 200,
  })
}
