import assert from "node:assert/strict"
import test from "node:test"

import type { ClientConversation, ClientConversationMember } from "../src/core/models/index.ts"
import { orderConversations } from "../src/domain/conversations/conversation-order.ts"
import { createMentionCandidates } from "../src/features/conversation/composer/mention-model.ts"

const assistantId = "00000000-0000-0000-0000-000000000001"
const assistant = {
  id: assistantId,
  type: "app",
  name: "自定义助理名",
  avatar: "",
} as ClientConversationMember

test("非群聊仅展示茉莉名字，且不展示@所有人", () => {
  assert.deepEqual(
    createMentionCandidates([assistant], false).map(({ id, label }) => ({ id, label })),
    [{ id: assistantId, label: "自定义助理名" }]
  )
  assert.deepEqual(
    createMentionCandidates([assistant]).map(({ id }) => id),
    ["all", assistantId]
  )
  assert.deepEqual(
    createMentionCandidates([], false).map(({ id, label }) => ({ id, label })),
    [{ id: assistantId, label: "茉莉" }]
  )
  assert.equal(createMentionCandidates([], false, "重命名茉莉")[0]?.label, "重命名茉莉")
})

test("其他应用会话包含茉莉时不置顶", () => {
  const regularApp = {
    id: "regular-app",
    type: "app",
    members: [
      { id: "22222222-2222-2222-2222-222222222222", type: "app" },
      assistant,
    ],
    lastMessageAt: "2026-07-01T00:00:00Z",
  } as ClientConversation
  const newerGroup = {
    id: "newer-group",
    type: "group",
    lastMessageAt: "2026-07-20T00:00:00Z",
  } as ClientConversation
  assert.deepEqual(
    orderConversations([regularApp, newerGroup]).map(({ id }) => id),
    ["newer-group", "regular-app"]
  )
})
