import type { ClientConversation } from "@/core/models"

const BUILTIN_ASSISTANT_APP_ID = "00000000-0000-0000-0000-000000000001"
const TOPIC_CONVERSATION_LIST_ACTIVITY_WINDOW_MS = 30 * 60 * 1000

export function orderConversations(
  conversations: ClientConversation[],
  now = Date.now()
) {
  const parentConversations: ClientConversation[] = []
  const orphanTopics: ClientConversation[] = []
  const topicsByParentId = new Map<string, ClientConversation[]>()
  const parentIds = new Set(
    conversations
      .filter((conversation) => conversation.type !== "topic")
      .map((conversation) => conversation.id)
  )

  for (const conversation of conversations) {
    if (conversation.type !== "topic") {
      parentConversations.push(conversation)
      continue
    }

    const parentId = conversation.topic?.parentConversationId
    if (!parentId || !parentIds.has(parentId)) {
      orphanTopics.push(conversation)
      continue
    }

    const topics = topicsByParentId.get(parentId) ?? []
    topics.push(conversation)
    topicsByParentId.set(parentId, topics)
  }

  parentConversations.sort((left, right) => {
    const leftTopics = getActiveTopicChildren(
      topicsByParentId.get(left.id) ?? [],
      now
    )
    const rightTopics = getActiveTopicChildren(
      topicsByParentId.get(right.id) ?? [],
      now
    )
    return compareConversationGroups(left, leftTopics, right, rightTopics)
  })

  const ordered: ClientConversation[] = []
  for (const parent of parentConversations) {
    ordered.push(parent)
    const topics = topicsByParentId.get(parent.id) ?? []
    topics.sort(compareTopicConversationItems)
    ordered.push(...topics)
  }

  orphanTopics.sort(compareTopicConversationItems)
  ordered.push(...orphanTopics)
  return ordered
}

export function flattenVisibleConversations(
  conversations: ClientConversation[],
  options: { activeConversationId?: string; now?: number } = {}
) {
  const ordered = orderConversations(conversations, options.now)
  const parentIds = new Set(
    ordered
      .filter((conversation) => conversation.type !== "topic")
      .map((conversation) => conversation.id)
  )

  return ordered.filter((conversation) => {
    if (conversation.type !== "topic") return true

    const parentId = conversation.topic?.parentConversationId
    return (
      Boolean(parentId && parentIds.has(parentId)) &&
      isConversationTopicVisibleInList(conversation, options)
    )
  })
}

export function isConversationTopicVisibleInList(
  conversation: ClientConversation,
  options: { activeConversationId?: string; now?: number } = {}
) {
  if (conversation.type !== "topic") {
    return true
  }

  if (!conversation.topic?.participating || conversation.topic.archived) {
    return false
  }

  if (conversation.id === options.activeConversationId) {
    return true
  }

  if (
    conversation.unreadCount > 0 ||
    conversation.lastMessageSeq > conversation.lastReadSeq
  ) {
    return true
  }

  const activityAt = getConversationActivityTimestamp(conversation)
  return (
    Number.isFinite(activityAt) &&
    activityAt >=
      (options.now ?? Date.now()) - TOPIC_CONVERSATION_LIST_ACTIVITY_WINDOW_MS
  )
}

export function isBuiltinAssistantConversation(
  conversation: ClientConversation
) {
  return (
    conversation.type === "app" &&
    conversation.members?.some(
      (member) =>
        member.type === "app" && member.id === BUILTIN_ASSISTANT_APP_ID
    ) === true
  )
}

function getConversationActivityTimestamp(conversation: ClientConversation) {
  const timestamp = Date.parse(
    conversation.lastMessageAt ?? conversation.createdAt
  )

  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

function getActiveTopicChildren(topics: ClientConversation[], now: number) {
  return topics.filter((topic) =>
    isConversationTopicVisibleInList(topic, { now })
  )
}

function compareConversationGroups(
  left: ClientConversation,
  leftTopics: ClientConversation[],
  right: ClientConversation,
  rightTopics: ClientConversation[]
) {
  const leftIsBuiltinAssistant = isBuiltinAssistantConversation(left)
  const rightIsBuiltinAssistant = isBuiltinAssistantConversation(right)

  if (leftIsBuiltinAssistant !== rightIsBuiltinAssistant) {
    return leftIsBuiltinAssistant ? -1 : 1
  }

  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1
  }

  const leftActivity = getConversationGroupActivityTimestamp(left, leftTopics)
  const rightActivity = getConversationGroupActivityTimestamp(
    right,
    rightTopics
  )

  if (leftActivity !== rightActivity) {
    return rightActivity - leftActivity
  }

  return compareConversationIds(left, right)
}

function getConversationGroupActivityTimestamp(
  parent: ClientConversation,
  topics: ClientConversation[]
) {
  return topics.reduce(
    (latest, topic) =>
      Math.max(latest, getConversationActivityTimestamp(topic)),
    getConversationActivityTimestamp(parent)
  )
}

function compareTopicConversationItems(
  left: ClientConversation,
  right: ClientConversation
) {
  const leftActivity = getConversationActivityTimestamp(left)
  const rightActivity = getConversationActivityTimestamp(right)

  if (leftActivity !== rightActivity) {
    return rightActivity - leftActivity
  }

  return compareConversationIds(left, right)
}

function compareConversationIds(
  left: ClientConversation,
  right: ClientConversation
) {
  return left.id.localeCompare(right.id)
}
