const lastConversationStorageKeyPrefix = "dianbao.chat.last-conversation.v1."
const maxStoredConversationIdLength = 512

export function readLastConversationId(userId: string) {
  if (typeof window === "undefined" || !userId) {
    return ""
  }

  try {
    const storageKey = getLastConversationStorageKey(userId)
    const storedConversationId = window.localStorage.getItem(storageKey)
    const conversationId = normalizeConversationId(storedConversationId)

    if (storedConversationId !== null && !conversationId) {
      window.localStorage.removeItem(storageKey)
    }

    return conversationId
  } catch {
    return ""
  }
}

export function writeLastConversationId(
  userId: string,
  conversationId: string
) {
  if (typeof window === "undefined" || !userId) {
    return false
  }

  const normalizedConversationId = normalizeConversationId(conversationId)
  if (!normalizedConversationId) {
    return clearLastConversationId(userId)
  }

  try {
    window.localStorage.setItem(
      getLastConversationStorageKey(userId),
      normalizedConversationId
    )
    return true
  } catch {
    return false
  }
}

export function clearLastConversationId(userId: string) {
  if (typeof window === "undefined" || !userId) {
    return false
  }

  try {
    window.localStorage.removeItem(getLastConversationStorageKey(userId))
    return true
  } catch {
    return false
  }
}

function getLastConversationStorageKey(userId: string) {
  return `${lastConversationStorageKeyPrefix}${encodeURIComponent(userId)}`
}

function normalizeConversationId(value: string | null) {
  const conversationId = value?.trim() ?? ""
  if (
    !conversationId ||
    conversationId.length > maxStoredConversationIdLength
  ) {
    return ""
  }

  return conversationId
}
