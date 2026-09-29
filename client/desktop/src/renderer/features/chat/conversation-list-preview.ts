import type { DesktopConversation } from "../../../shared/account-data.ts"
import { formatMentionText, type MentionLabelResolver } from "../../lib/message-mentions.ts"

// 群聊（及群内话题）的列表摘要与 client/web 一致，前面展示发送者。
export function formatConversationSummary(
  conversation: DesktopConversation,
  mentionLabelResolver: MentionLabelResolver,
  currentUserId: string,
) {
  if (!conversation.lastMessageSummary) return "暂无消息"
  const description = formatMentionText(conversation.lastMessageSummary, mentionLabelResolver)
  const senderName = senderDisplayName(conversation, mentionLabelResolver, currentUserId)
  return senderName ? `${senderName}：${description}` : description
}

// 发送者名字按通讯录现查，消息里存的 sender_name 只作兜底。
function senderDisplayName(
  conversation: DesktopConversation,
  mentionLabelResolver: MentionLabelResolver,
  currentUserId: string,
) {
  const inGroup =
    conversation.type === "group" ||
    (conversation.type === "topic" && conversation.topic?.parentConversationType === "group")
  const sender = conversation.lastMessageSender
  if (!inGroup || !sender) return ""
  // 系统消息不展示发送者前缀。
  if (sender.type === "system") return ""
  if (sender.type === "user" && sender.id.toLowerCase() === currentUserId.toLowerCase()) return "我"
  const label =
    sender.id && (sender.type === "user" || sender.type === "app")
      ? mentionLabelResolver({ id: sender.id, type: sender.type })
      : undefined
  return (label || sender.name).trim()
}
