import assert from "node:assert/strict"
import test from "node:test"
import type { DesktopMessage } from "../src/shared/account-data.ts"
import {
  canCreateDesktopMessageTopic,
  canRevokeDesktopMessage,
  getDesktopMessageEditableBody,
} from "../src/renderer/features/chat/message-actions.ts"

test("非话题会话中的服务端消息可以创建话题", () => {
  const source = message()
  assert.equal(canCreateDesktopMessageTopic(source, true, false), true)
  assert.equal(
    canCreateDesktopMessageTopic(
      { ...source, topic: { conversationId: "topic-1", archived: false, recentReplies: [] } },
      true,
      false,
    ),
    false,
  )
  assert.equal(canCreateDesktopMessageTopic(source, false, false), false)
  assert.equal(
    canCreateDesktopMessageTopic({ ...source, deliveryStatus: "sending" }, true, false),
    false,
  )
  assert.equal(
    canCreateDesktopMessageTopic(
      { ...source, bodyType: "revoked", body: { type: "revoked" } },
      true,
      false,
    ),
    false,
  )
})

test("只有本人撤回的可编辑消息可以重新编辑", () => {
  const revokedMessage: DesktopMessage = {
    ...message(),
    bodyType: "revoked",
    body: {
      type: "revoked",
      editableBody: { type: "markdown", content: "**重新编辑**" },
    },
  }
  assert.deepEqual(getDesktopMessageEditableBody(revokedMessage), {
    type: "markdown",
    content: "**重新编辑**",
  })
  assert.equal(getDesktopMessageEditableBody({ ...revokedMessage, isMine: false }), undefined)
  assert.equal(
    getDesktopMessageEditableBody({ ...revokedMessage, body: { type: "revoked" } }),
    undefined,
  )
})

test("本人或群管理员可以撤回普通服务端消息", () => {
  const ownMessage = message()
  assert.equal(canRevokeDesktopMessage(ownMessage, true, false, false), true)
  assert.equal(canRevokeDesktopMessage({ ...ownMessage, isMine: false }, true, false, false), false)
  assert.equal(canRevokeDesktopMessage({ ...ownMessage, isMine: false }, true, true, false), true)
  assert.equal(
    canRevokeDesktopMessage({ ...ownMessage, deliveryStatus: "sending" }, true, false, false),
    false,
  )
  assert.equal(
    canRevokeDesktopMessage({ ...ownMessage, virtualType: "topic_source" }, true, false, false),
    false,
  )
})

test("已撤回、归档话题和正在撤回的消息不提供撤回", () => {
  const ownMessage = message()
  assert.equal(
    canRevokeDesktopMessage(
      { ...ownMessage, bodyType: "revoked", body: { type: "revoked" } },
      true,
      false,
      false,
    ),
    false,
  )
  assert.equal(canRevokeDesktopMessage(ownMessage, false, false, false), false)
  assert.equal(canRevokeDesktopMessage(ownMessage, true, false, true), false)
})

function message(): DesktopMessage {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    seq: 1,
    createdAt: "2026-09-23T00:00:00Z",
    senderId: "user-1",
    senderType: "user",
    senderName: "Alice",
    isMine: true,
    bodyType: "text",
    content: "正文",
    clientMessageId: "",
    body: { type: "text", content: "正文" },
    reactions: [],
  }
}
