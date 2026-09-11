import type {
  ClientContacts,
  ClientConversation,
  ClientMessage,
  ClientMessageList,
} from "@/core/models"
import { flattenVisibleConversations } from "@/domain/conversations/conversation-order"
import { getContactDisplayName } from "@/domain/contacts/contact-display"
import type { MessageMentionLabelResolver } from "@/domain/messages/message-mentions"
import { formatClientMessageBodySummary } from "@/domain/messages/message-presenter"

export type ConversationListItemModel = {
  conversation: ClientConversation
  description: string
  lastMessageTime: string
  nested: boolean
  pinnedBackground: boolean
  unreadAlertLabel: "[选择]" | "[有人 @ 我]" | null
}

export function collectLatestConversationMessages(
  entries: readonly {
    conversationId: string
    pages: readonly ClientMessageList[] | undefined
  }[]
) {
  const latest = new Map<string, ClientMessage>()
  for (const entry of entries) {
    for (const page of entry.pages ?? []) {
      for (const message of page.messages) {
        const current = latest.get(entry.conversationId)
        if (!current || message.seq > current.seq) {
          latest.set(entry.conversationId, message)
        }
      }
    }
  }
  return latest
}

export function buildConversationListItems({
  activeConversationId,
  contacts,
  conversations,
  currentUserId,
  keyword,
  latestMessages = new Map(),
  now = new Date(),
}: {
  activeConversationId?: string
  contacts: ClientContacts
  conversations: ClientConversation[]
  currentUserId: string
  keyword: string
  latestMessages?: ReadonlyMap<string, ClientMessage>
  now?: Date
}): ConversationListItemModel[] {
  const labels = createMentionLabels(contacts, conversations)
  const normalizedKeyword = keyword.trim().toLocaleLowerCase()
  const rows = getConversationListRows({
    activeConversationId,
    conversations,
    now: now.getTime(),
  })

  const items = rows.map(({ conversation, nested, pinnedBackground }) => {
    const messageDescription = formatConversationDescription(
      conversation,
      latestMessages.get(conversation.id),
      labels,
      currentUserId
    )
    const unreadAlertLabel = getConversationUnreadAlertLabel(conversation)
    const description = formatConversationUnreadDescription(
      messageDescription,
      unreadAlertLabel
    )

    return {
      conversation,
      description,
      lastMessageTime: formatActivityTime(
        conversation.lastMessageAt ?? conversation.createdAt,
        now
      ),
      nested,
      pinnedBackground,
      unreadAlertLabel,
    }
  })

  if (!normalizedKeyword) {
    return items
  }

  const includedIds = new Set(
    items
      .filter(
        ({ conversation, description }) =>
          conversation.name.toLocaleLowerCase().includes(normalizedKeyword) ||
          description.toLocaleLowerCase().includes(normalizedKeyword)
      )
      .map(({ conversation }) => conversation.id)
  )

  for (const item of items) {
    if (item.nested && includedIds.has(item.conversation.id)) {
      const parentId = item.conversation.topic?.parentConversationId
      if (parentId) includedIds.add(parentId)
    }
  }

  return items.filter(({ conversation }) => includedIds.has(conversation.id))
}

function getConversationListRows({
  activeConversationId,
  conversations,
  now,
}: {
  activeConversationId?: string
  conversations: ClientConversation[]
  now: number
}) {
  const orderedConversations = flattenVisibleConversations(conversations, {
    activeConversationId,
    now,
  })
  const parentById = new Map(
    orderedConversations
      .filter((conversation) => conversation.type !== "topic")
      .map((conversation) => [conversation.id, conversation])
  )
  const topicsByParentId = new Map<string, ClientConversation[]>()

  for (const conversation of orderedConversations) {
    if (conversation.type !== "topic") {
      continue
    }

    const parentId = conversation.topic?.parentConversationId
    if (!parentId || !parentById.has(parentId)) {
      continue
    }

    const topics = topicsByParentId.get(parentId) ?? []
    topics.push(conversation)
    topicsByParentId.set(parentId, topics)
  }

  const rows: {
    conversation: ClientConversation
    nested: boolean
    pinnedBackground: boolean
  }[] = []
  for (const conversation of orderedConversations) {
    if (conversation.type === "topic") {
      continue
    }

    const pinnedBackground = conversation.pinned
    rows.push({ conversation, nested: false, pinnedBackground })
    rows.push(
      ...(topicsByParentId.get(conversation.id) ?? []).map((topic) => ({
        conversation: topic,
        nested: true,
        pinnedBackground,
      }))
    )
  }

  return rows
}

export function getBoundedConversationIds(
  items: readonly ConversationListItemModel[],
  limit: number
) {
  if (limit <= 0) return []

  return items.slice(0, limit).map((item) => item.conversation.id)
}

export function findLatestUnreadConversationIndex(
  items: ConversationListItemModel[]
) {
  let latestIndex = -1
  let latestActivityAt = Number.NEGATIVE_INFINITY

  items.forEach((item, index) => {
    if (item.conversation.unreadCount <= 0) return

    const activityAt = Date.parse(
      item.conversation.lastMessageAt ?? item.conversation.createdAt
    )
    if (Number.isNaN(activityAt) || activityAt <= latestActivityAt) return

    latestIndex = index
    latestActivityAt = activityAt
  })

  return latestIndex
}

export function formatConversationUnreadDescription(
  description: string,
  unreadAlertLabel: ConversationListItemModel["unreadAlertLabel"]
) {
  return unreadAlertLabel === "[选择]"
    ? description.replace(/(^|：)\[选择\]\s*/, "$1")
    : description
}

export function getConversationUnreadAlertLabel(
  conversation: ClientConversation
): ConversationListItemModel["unreadAlertLabel"] {
  const hasUnreadChoice = conversation.lastChoiceSeq > conversation.lastReadSeq
  const hasUnreadMention =
    conversation.lastMentionedSeq > conversation.lastReadSeq
  if (
    hasUnreadChoice &&
    conversation.lastChoiceSeq >= conversation.lastMentionedSeq
  ) {
    return "[选择]"
  }
  return hasUnreadMention ? "[有人 @ 我]" : null
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
  message: ClientMessage | undefined,
  labels: {
    appLabels: ReadonlyMap<string, string>
    userLabels: ReadonlyMap<string, string>
  },
  currentUserId: string
) {
  if (!message) {
    return "暂无消息"
  }

  const resolveMentionLabel: MessageMentionLabelResolver = ({ id, type }) => {
    if (type === "all") return undefined
    return type === "app"
      ? labels.appLabels.get(id.toLowerCase())
      : labels.userLabels.get(id.toLowerCase())
  }

  const description = formatClientMessageBodySummary(
    message.body,
    resolveMentionLabel
  )
  const showsSender =
    conversation.type === "group" ||
    (conversation.type === "topic" &&
      conversation.topic?.parentConversationType === "group")

  if (!showsSender) {
    return description
  }

  const senderName = getLastMessageSenderName(message, labels, currentUserId)
  return senderName ? `${senderName}：${description}` : description
}

function getLastMessageSenderName(
  message: ClientMessage,
  labels: {
    appLabels: ReadonlyMap<string, string>
    userLabels: ReadonlyMap<string, string>
  },
  currentUserId: string
) {
  const sender = message.sender

  if (sender.type === "system") {
    return "系统"
  }

  if (sender.type === "user" && sender.id === currentUserId) {
    return "我"
  }

  const senderLabels = sender.type === "app" ? labels.appLabels : labels.userLabels
  return senderLabels.get(sender.id.toLowerCase()) ?? ""
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
