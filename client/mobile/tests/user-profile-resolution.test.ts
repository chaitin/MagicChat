import { installTestAccountRuntime } from "./auth-runtime-test-helper.ts"
import assert from "node:assert/strict"
import test from "node:test"

import { fetchContacts } from "@/data/contacts/contacts-api"
import { fetchConversations } from "@/data/conversations/conversations-api"
import { normalizeClientMessage } from "@/data/messages/message-normalizer"
import { resolveClientUsers } from "@/data/users/user-profiles-api"

const serverUrl = "https://chat.example.com"

test("loads contact user IDs without requiring embedded user profiles", async () => {
  const requests: Array<{ init?: RequestInit; url: string }> = []
  const contacts = await fetchContacts(installTestAccountRuntime({ id: "server-1", url: serverUrl, userId: "user-current" }), {
    fetcher: async (url, init) => {
      requests.push({ init, url })
      return jsonResponse({
        apps: [],
        groups: [],
        user_ids: ["user-1", "user-2"],
      })
    },
  })

  assert.deepEqual(contacts, {
    apps: [],
    groups: [],
    userIds: ["user-1", "user-2"],
  })
  assert.equal(requests[0]?.url, `${serverUrl}/api/client/contacts`)
  assert.equal(requests[0]?.init?.method, "GET")
})

test("resolves complete user profiles in one ID batch", async () => {
  let requestBody = ""
  const users = await resolveClientUsers(installTestAccountRuntime({ id: "server-1", url: serverUrl, userId: "user-current" }), ["user-1", "user-2"], {
    fetcher: async (_url, init) => {
      requestBody = String(init?.body)
      return jsonResponse({
        users: [
          {
            email: "alice@example.com",
            id: "user-1",
            name: "Alice",
            updated_at: "2026-08-11T10:00:00Z",
          },
          {
            email: "bob@example.com",
            id: "user-2",
            name: "Bob",
            nickname: "Bobby",
            online: true,
            updated_at: "2026-08-11T10:00:01Z",
          },
        ],
      })
    },
  })

  assert.deepEqual(JSON.parse(requestBody), {
    user_ids: ["user-1", "user-2"],
  })
  assert.deepEqual(
    users.map((user) => [user.id, user.nickname, user.updatedAt]),
    [
      ["user-1", "", "2026-08-11T10:00:00Z"],
      ["user-2", "Bobby", "2026-08-11T10:00:01Z"],
    ]
  )
})

test("accepts ID-only user references in conversations and messages", async () => {
  const conversations = await fetchConversations(installTestAccountRuntime({ id: "server-1", url: serverUrl, userId: "user-current" }), {
    fetcher: async () =>
      jsonResponse({
        conversations: [
          {
            created_at: "2026-08-11T10:00:00Z",
            id: "conversation-1",
            last_message_sender: { id: "user-2", type: "user" },
            members: [{ id: "user-2", role: "member", type: "user" }],
            name: "Direct chat",
            topic: {
              parent_conversation_id: "conversation-parent",
              parent_conversation_name: "Parent",
              source_message_id: "message-source",
              source_message_seq: 1,
              source_sender: { id: "user-2", type: "user" },
            },
            type: "direct",
          },
        ],
      }),
  })

  assert.equal(conversations[0]?.members?.[0]?.id, "user-2")
  assert.equal(conversations[0]?.members?.[0]?.name, "")
  assert.equal(conversations[0]?.topic?.sourceSender.name, "")

  const message = normalizeClientMessage({
    body: { content: "hello", type: "text" },
    conversation_id: "conversation-1",
    created_at: "2026-08-11T10:00:00Z",
    id: "message-1",
    reactions: [
      {
        count: 1,
        reacted_by_me: false,
        text: "👍",
        users: [{ id: "user-2" }],
      },
    ],
    reply_to: {
      id: "message-previous",
      sender: { id: "user-2", type: "user" },
      seq: 0,
      summary: "previous message",
    },
    sender: { id: "user-2", type: "user" },
    seq: 1,
  })

  assert.deepEqual(message.reactions[0]?.users, [{ id: "user-2", name: "" }])
  assert.deepEqual(message.replyTo?.sender, {
    id: "user-2",
    name: "",
    type: "user",
  })
})

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ data, success: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  })
}
