import type { ClientConversation, ClientMessage } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { conversationManager } from "@/data/conversations"
import { messageManager } from "@/data/messages"
import { formatClientMessageBodySummary } from "@/domain/messages/message-presenter"
import { normalizeMessageEventPayload } from "./realtime-payload"

export async function projectRealtimeMessage(server: AuthenticatedTarget, payload: unknown, options: { markReadConversationId?: string; received: boolean }) {
  const normalized = normalizeMessageEventPayload(payload)
  const message = normalized.message
  await messageManager.writeMessages(server, [message])
  await persistTopicSourcePreview(server, message)
  await updateConversationFromMessage(server, message, {
    markRead: options.markReadConversationId === message.conversationId,
    received: options.received,
  })
  return normalized
}

async function updateConversationFromMessage(server: AuthenticatedTarget, message: ClientMessage, options: { markRead: boolean; received: boolean }) {
  const updated = await conversationManager.patch(server, message.conversationId, (conversation) => {
    const isLatestMessage = message.seq >= conversation.lastMessageSeq
    const isNewMessage = message.seq > conversation.lastMessageSeq
    const fromCurrentUser = message.sender.type === "user" && message.sender.id === server.userId
    const unreadCount = options.markRead ? 0 : options.received && isNewMessage && !fromCurrentUser ? conversation.unreadCount + 1 : conversation.unreadCount
    return {
      ...(isLatestMessage ? { lastMessageAt: message.createdAt, lastMessageId: message.id, lastMessageSeq: message.seq, lastMessageSender: getLastMessageSender(conversation, message), lastMessageSummary: formatClientMessageBodySummary(message.body, () => undefined) } : {}),
      ...(options.markRead ? { lastReadSeq: Math.max(conversation.lastReadSeq, message.seq) } : {}),
      unreadCount,
    }
  })
  if (!updated) void conversationManager.refresh(server).catch(() => undefined)
}

function getLastMessageSender(conversation: ClientConversation, message: ClientMessage): ClientConversation["lastMessageSender"] {
  if (message.sender.type === "system") return { id: message.sender.id, name: "系统", nickname: "", type: "system" }
  const member = conversation.members?.find((item) => item.id === message.sender.id && item.type === message.sender.type)
  return { id: message.sender.id, name: member?.name ?? "", nickname: member?.nickname ?? "", type: message.sender.type }
}

async function persistTopicSourcePreview(target: AuthenticatedTarget, message: ClientMessage) {
  const conversation = await conversationManager.get(target, message.conversationId)
  const topic = conversation?.type === "topic" ? conversation.topic : undefined
  if (!topic) return
  await messageManager.updateTopicSourcePreview(target, { message, parentConversationId: topic.parentConversationId, sourceMessageId: topic.sourceMessageId })
}
