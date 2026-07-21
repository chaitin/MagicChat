import type {
  ClientContacts,
  ClientConversation,
} from "@/data/models"
import { orderConversations } from "@/domain/conversations/conversation-order"
import { getContactDisplayName } from "@/domain/contacts/contact-display"
import {
  formatMentionTemplateText,
  type MessageMentionLabelResolver,
} from "@/domain/messages/message-mentions"

export type ConversationListItemModel = {
  conversation: ClientConversation
  description: string
  hasUnreadMention: boolean
  lastMessageTime: string
}

export function buildConversationListItems({
  contacts,
  conversations,
  keyword,
  now = new Date(),
}: {
  contacts: ClientContacts
  conversations: ClientConversation[]
  keyword: string
  now?: Date
}): ConversationListItemModel[] {
  const labels = createMentionLabels(contacts, conversations)
  const normalizedKeyword = keyword.trim().toLocaleLowerCase()

  return orderConversations(conversations)
    .map((conversation) => {
      const description = formatConversationDescription(conversation, labels)

      return {
        conversation,
        description,
        hasUnreadMention:
          conversation.lastMentionedSeq > conversation.lastReadSeq,
        lastMessageTime: formatActivityTime(
          conversation.lastMessageAt ?? conversation.createdAt,
          now
        ),
      }
    })
    .filter(
      ({ conversation, description }) =>
        normalizedKeyword.length === 0 ||
        conversation.name.toLocaleLowerCase().includes(normalizedKeyword) ||
        description.toLocaleLowerCase().includes(normalizedKeyword)
    )
}

export function formatUnreadCount(count: number) {
  return count > 99 ? "99+" : String(count)
}

function createMentionLabels(
  contacts: ClientContacts,
  conversations: ClientConversation[]
) {
  const appLabels = new Map(
    contacts.apps.map((app) => [app.id.toLowerCase(), app.name] as const)
  )
  const userLabels = new Map(
    contacts.users.map(
      (user) =>
        [user.id.toLowerCase(), getContactDisplayName(user)] as const
    )
  )

  for (const conversation of conversations) {
    for (const member of conversation.members ?? []) {
      const labels = member.type === "app" ? appLabels : userLabels

      if (!labels.has(member.id.toLowerCase())) {
        labels.set(
          member.id.toLowerCase(),
          member.nickname.trim() || member.name.trim()
        )
      }
    }
  }

  return { appLabels, userLabels }
}

function formatConversationDescription(
  conversation: ClientConversation,
  labels: {
    appLabels: ReadonlyMap<string, string>
    userLabels: ReadonlyMap<string, string>
  }
) {
  const summary = conversation.lastMessageSummary.trim()

  if (!summary) {
    return "暂无消息"
  }

  const resolveMentionLabel: MessageMentionLabelResolver = ({ id, type }) => {
    if (type === "all") return undefined
    return type === "app"
      ? labels.appLabels.get(id.toLowerCase())
      : labels.userLabels.get(id.toLowerCase())
  }

  return formatMentionTemplateText(summary, resolveMentionLabel)
}

function formatActivityTime(activityAt: string | null, now: Date) {
  if (!activityAt) {
    return ""
  }

  const date = new Date(activityAt)

  if (Number.isNaN(date.getTime())) {
    return ""
  }

  if (!isSameLocalDay(date, now)) {
    return `${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  }).format(date)
}

function isSameLocalDay(date: Date, otherDate: Date) {
  return (
    date.getFullYear() === otherDate.getFullYear() &&
    date.getMonth() === otherDate.getMonth() &&
    date.getDate() === otherDate.getDate()
  )
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0")
}
