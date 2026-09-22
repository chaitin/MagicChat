import type { DesktopConversation } from "../../../shared/account-data"

export function groupConversationList(conversations: DesktopConversation[]) {
  const parents = conversations.filter((conversation) => conversation.type !== "topic")
  const parentIds = new Set(parents.map((conversation) => conversation.id))
  const topicsByParentId = new Map<string, DesktopConversation[]>()
  const orphanTopics: DesktopConversation[] = []

  for (const conversation of conversations) {
    if (conversation.type !== "topic") continue
    const parentId = conversation.topic?.parentConversationId
    if (!parentId || !parentIds.has(parentId)) {
      orphanTopics.push(conversation)
      continue
    }
    const topics = topicsByParentId.get(parentId) ?? []
    topics.push(conversation)
    topicsByParentId.set(parentId, topics)
  }

  parents.sort((left, right) =>
    compareConversationGroups(
      left,
      topicsByParentId.get(left.id) ?? [],
      right,
      topicsByParentId.get(right.id) ?? [],
    ),
  )
  for (const topics of topicsByParentId.values()) topics.sort(compareConversationActivity)
  orphanTopics.sort(compareConversationActivity)

  const pinned: DesktopConversation[] = []
  const regular: DesktopConversation[] = []
  for (const parent of parents) {
    const destination = parent.pinned || parent.isBuiltinAssistant ? pinned : regular
    destination.push(parent, ...(topicsByParentId.get(parent.id) ?? []))
  }
  regular.push(...orphanTopics)
  return { pinned, regular }
}

function compareConversationGroups(
  left: DesktopConversation,
  leftTopics: DesktopConversation[],
  right: DesktopConversation,
  rightTopics: DesktopConversation[],
) {
  if (left.isBuiltinAssistant !== right.isBuiltinAssistant) {
    return left.isBuiltinAssistant ? -1 : 1
  }
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
  const activityDifference =
    conversationGroupActivity(right, rightTopics) - conversationGroupActivity(left, leftTopics)
  return activityDifference || left.id.localeCompare(right.id)
}

function conversationGroupActivity(parent: DesktopConversation, topics: DesktopConversation[]) {
  return topics.reduce(
    (latest, topic) => Math.max(latest, conversationActivity(topic)),
    conversationActivity(parent),
  )
}

function compareConversationActivity(left: DesktopConversation, right: DesktopConversation) {
  return conversationActivity(right) - conversationActivity(left) || left.id.localeCompare(right.id)
}

function conversationActivity(conversation: DesktopConversation) {
  const timestamp = Date.parse(conversation.lastMessageAt ?? conversation.createdAt)
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}
