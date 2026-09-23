import type { AvatarType } from "../../shared/account-data"
import { AuthFailure, isRecord } from "../../shared/auth"
import type { StoredConversation, StoredMessage } from "./account-database"
import type { AvatarDescriptor, AvatarMemberDescriptor } from "./avatar-types"
import { normalizeDesktopMessageDetails, summarizeDesktopMessageBody } from "./message-normalizer"
import { parseConversationTopic } from "./conversation-topic"

const builtinAssistantAppId = "00000000-0000-0000-0000-000000000001"

export function parseConversationBooleanEvent(payload: unknown, field: "pinned" | "muted") {
  if (!isRecord(payload) || typeof payload[field] !== "boolean") {
    throw new AuthFailure("invalid_realtime_event", "会话状态推送格式不正确")
  }
  return {
    conversationId: conversationIdFromEvent(payload),
    value: payload[field],
  }
}

export function conversationIdFromEvent(payload: unknown) {
  if (!isRecord(payload)) {
    throw new AuthFailure("invalid_realtime_event", "会话推送格式不正确")
  }
  return requiredString(payload.conversation_id, 128, "event.conversation_id")
}

export function parseConversation(value: unknown, currentUserId: string): StoredConversation {
  if (!isRecord(value)) throw new AuthFailure("invalid_response", "会话列表响应格式不正确")
  const id = requiredString(value.id, 128, "conversation.id")
  const type = requiredString(value.type, 32, "conversation.type")
  const name = requiredString(value.name, 256, "conversation.name")
  const avatarIdentity = conversationAvatarIdentity(value, id, type, currentUserId)
  return {
    id,
    type,
    name,
    memberCount: type === "group" ? nonNegativeInteger(value.member_count) : 0,
    avatar: optionalString(value.avatar, 4_096),
    avatarType: avatarIdentity.type,
    avatarId: avatarIdentity.id,
    createdAt: requiredString(value.created_at, 64, "conversation.created_at"),
    lastMessageAt: nullableString(value.last_message_at, 64),
    lastMessageSummary: "",
    pinned: value.pinned === true,
    notificationMuted: value.notification_muted === true,
    isBuiltinAssistant:
      type === "app" &&
      Array.isArray(value.members) &&
      value.members.some(
        (member) =>
          isRecord(member) && member.type === "app" && member.id === builtinAssistantAppId,
      ),
    unreadCount: nonNegativeInteger(value.unread_count),
    lastMessageSeq: nonNegativeInteger(value.last_message_seq),
    lastReadSeq: nonNegativeInteger(value.last_read_seq),
    topic: parseConversationTopic(value),
    payload: value,
  }
}

export function parseMessage(value: unknown, expectedConversationId: string): StoredMessage {
  if (!isRecord(value)) throw new AuthFailure("invalid_response", "聊天记录响应格式不正确")
  const conversationId = requiredString(value.conversation_id, 128, "message.conversation_id")
  if (conversationId !== expectedConversationId) {
    throw new AuthFailure("invalid_response", "聊天记录所属会话不正确")
  }
  if (!isRecord(value.sender)) {
    throw new AuthFailure("invalid_response", "聊天记录发送者格式不正确")
  }
  const details = normalizeDesktopMessageDetails(value)
  const senderType = requiredString(value.sender.type, 32, "message.sender.type")
  const senderId =
    senderType === "system"
      ? optionalString(value.sender.id, 128)
      : requiredString(value.sender.id, 128, "message.sender.id")
  return {
    id: requiredString(value.id, 128, "message.id"),
    conversationId,
    seq:
      details.virtualType === "topic_source"
        ? nonNegativeInteger(value.seq)
        : positiveInteger(value.seq),
    createdAt: requiredString(value.created_at, 64, "message.created_at"),
    senderId,
    senderType,
    senderName:
      optionalString(value.sender.nickname, 256) ||
      optionalString(value.sender.name, 256) ||
      (senderType === "system" ? "系统" : ""),
    isMine: false,
    bodyType: details.body.type,
    content: summarizeDesktopMessageBody(details.body),
    clientMessageId: optionalString(value.client_message_id, 128),
    deliveryStatus: undefined,
    ...details,
    payload: value,
  }
}

export function avatarDescriptorFromConversationPayload(
  type: "group" | "topic",
  entityId: string,
  payload: unknown,
): AvatarDescriptor | undefined {
  if (!isRecord(payload)) return undefined
  if (type === "topic" && isRecord(payload.topic)) {
    const parentId = optionalString(payload.topic.parent_conversation_id, 128)
    const parentType = avatarTypeForConversation(
      optionalString(payload.topic.parent_conversation_type, 32),
    )
    if (parentId) {
      return {
        type: parentType,
        id: parentId,
        name:
          optionalString(payload.topic.parent_conversation_name, 256) ||
          optionalString(payload.name, 256),
        avatarUrl: optionalString(payload.avatar, 4_096),
        ...(parentType === "group" ? { members: parseAvatarMembers(payload.members) } : {}),
      }
    }
  }
  return {
    type: "group",
    id: entityId,
    name: optionalString(payload.name, 256),
    avatarUrl: optionalString(payload.avatar, 4_096),
    members: parseAvatarMembers(payload.members),
  }
}

function conversationAvatarIdentity(
  value: Record<string, unknown>,
  conversationId: string,
  conversationType: string,
  currentUserId: string,
): { type: AvatarType; id: string } {
  if (conversationType === "topic") return { type: "topic", id: conversationId }
  if (conversationType === "direct" || conversationType === "app") {
    const members = parseAvatarMembers(value.members)
    const preferred = members.find((member) =>
      conversationType === "app" ? member.type === "app" : member.id !== currentUserId,
    )
    if (preferred) return { type: preferred.type, id: preferred.id }
  }
  return { type: "group", id: conversationId }
}

function avatarTypeForConversation(type: string): AvatarDescriptor["type"] {
  if (type === "direct" || type === "user") return "user"
  if (type === "app") return "app"
  if (type === "project") return "project"
  return "group"
}

function parseAvatarMembers(value: unknown): AvatarMemberDescriptor[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((member) => {
    if (!isRecord(member) || typeof member.id !== "string" || !member.id) return []
    return [
      {
        type: member.type === "app" ? "app" : "user",
        id: member.id,
        name: optionalString(member.nickname, 256) || optionalString(member.name, 256),
        avatarUrl: optionalString(member.avatar, 4_096),
        role: member.role === "owner" || member.role === "admin" ? member.role : "member",
      } satisfies AvatarMemberDescriptor,
    ]
  })
}

export function requiredString(value: unknown, maximum: number, field: string): string {
  if (typeof value !== "string") {
    throw new AuthFailure("invalid_response", `响应字段 ${field} 格式不正确`)
  }
  const result = value.trim()
  if (!result || result.length > maximum) {
    throw new AuthFailure("invalid_response", `响应字段 ${field} 格式不正确`)
  }
  return result
}

function optionalString(value: unknown, maximum: number): string {
  return typeof value === "string" && value.length <= maximum ? value : ""
}

function nullableString(value: unknown, maximum: number): string | null {
  return value === null || value === undefined ? null : optionalString(value, maximum) || null
}

function nonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new AuthFailure("invalid_response", "响应序号格式不正确")
  }
  return Number(value)
}
