import type {
  ClientConversation,
  ClientMessageList,
} from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { flattenVisibleConversations } from "@/domain/conversations/conversation-order"

export const HISTORY_PRE_SYNC_CONVERSATION_LIMIT = 20
export const HISTORY_PRE_SYNC_MESSAGE_LIMIT = 1_000
export const HISTORY_PRE_SYNC_PAGE_SIZE = 20
export const HISTORY_PRE_SYNC_MAX_ATTEMPTS = 3
export const HISTORY_PRE_SYNC_CONCURRENCY = 3

type HistorySyncState = {
  hasMoreBefore: boolean
  httpSyncedThroughSeq: number
  oldestCachedSeq: number | null
}

type CatchUpResult = {
  committedSeq: number
  result: ClientMessageList
}

export type HistoryPreSyncDependencies = {
  catchUpAfter: (
    target: AuthenticatedTarget,
    conversationId: string,
    afterSeq: number,
    limit: number
  ) => Promise<CatchUpResult>
  getSyncState: (
    target: AuthenticatedTarget,
    conversationId: string
  ) => Promise<HistorySyncState | null>
  loadMessagePage: (
    target: AuthenticatedTarget,
    conversationId: string,
    input: { beforeSeq?: number; limit: number }
  ) => Promise<ClientMessageList>
  synchronizeLatest: (
    target: AuthenticatedTarget,
    conversationId: string,
    limit: number
  ) => Promise<ClientMessageList>
}

export function selectHistoryPreSyncConversations(
  conversations: ClientConversation[],
  now = Date.now()
) {
  return flattenVisibleConversations(conversations, { now })
    .sort(compareLastActivity)
    .slice(0, HISTORY_PRE_SYNC_CONVERSATION_LIMIT)
}

export async function preSyncRecentConversationHistory(
  target: AuthenticatedTarget,
  conversations: ClientConversation[],
  dependencies: HistoryPreSyncDependencies,
  options: { now?: number } = {}
) {
  const selected = selectHistoryPreSyncConversations(
    conversations,
    options.now
  )

  await runWithConcurrency(
    selected,
    HISTORY_PRE_SYNC_CONCURRENCY,
    (conversation) =>
      preSyncConversationHistory(target, conversation, dependencies)
  )
}

export async function preSyncConversationHistory(
  target: AuthenticatedTarget,
  conversation: ClientConversation,
  dependencies: HistoryPreSyncDependencies
) {
  const initialState = await dependencies.getSyncState(target, conversation.id)
  const initialHistoryBoundary = positiveSeq(initialState?.oldestCachedSeq)
  let synchronizedMessageCount = 0
  let historyCursor = initialHistoryBoundary
  let hasMoreBefore = initialState?.hasMoreBefore ?? true
  let catchUpCursor = initialState?.httpSyncedThroughSeq ?? 0

  if (catchUpCursor <= 0) {
    const latest = await attemptPage(() =>
      dependencies.synchronizeLatest(
        target,
        conversation.id,
        HISTORY_PRE_SYNC_PAGE_SIZE
      )
    )
    synchronizedMessageCount += latest.messages.length
    catchUpCursor = latest.page.newestSeq
    historyCursor = positiveSeq(latest.page.oldestSeq)
    hasMoreBefore = latest.page.hasMoreBefore
  } else {
    while (
      catchUpCursor < conversation.lastMessageSeq &&
      synchronizedMessageCount < HISTORY_PRE_SYNC_MESSAGE_LIMIT
    ) {
      const limit = nextPageLimit(synchronizedMessageCount)
      const page = await attemptPage(() =>
        dependencies.catchUpAfter(
          target,
          conversation.id,
          catchUpCursor,
          limit
        )
      )
      synchronizedMessageCount += page.result.messages.length

      if (page.committedSeq <= catchUpCursor) break
      catchUpCursor = page.committedSeq
      if (!page.result.page.hasMoreAfter) break
    }
  }

  const synchronizedState = await dependencies.getSyncState(
    target,
    conversation.id
  )
  historyCursor =
    positiveSeq(synchronizedState?.oldestCachedSeq) ?? historyCursor
  hasMoreBefore = synchronizedState?.hasMoreBefore ?? hasMoreBefore

  while (
    historyCursor !== null &&
    hasMoreBefore &&
    synchronizedMessageCount < HISTORY_PRE_SYNC_MESSAGE_LIMIT &&
    (initialHistoryBoundary === null ||
      historyCursor > initialHistoryBoundary)
  ) {
    const beforeSeq = historyCursor
    const page = await attemptPage(() =>
      dependencies.loadMessagePage(target, conversation.id, {
        beforeSeq,
        limit: nextPageLimit(synchronizedMessageCount),
      })
    )
    synchronizedMessageCount += page.messages.length
    hasMoreBefore = page.page.hasMoreBefore

    const nextCursor = positiveSeq(page.page.oldestSeq)
    if (nextCursor === null || nextCursor >= beforeSeq) break
    historyCursor = nextCursor
  }
}

async function attemptPage<T>(operation: () => Promise<T>) {
  let lastError: unknown
  for (let attempt = 1; attempt <= HISTORY_PRE_SYNC_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<void>
) {
  let nextIndex = 0
  let firstError: unknown

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (firstError === undefined) {
        const index = nextIndex
        nextIndex += 1
        if (index >= items.length) return

        try {
          await operation(items[index]!)
        } catch (error) {
          firstError = error
        }
      }
    }
  )

  await Promise.all(workers)
  if (firstError !== undefined) throw firstError
}

function nextPageLimit(synchronizedMessageCount: number) {
  return Math.min(
    HISTORY_PRE_SYNC_PAGE_SIZE,
    HISTORY_PRE_SYNC_MESSAGE_LIMIT - synchronizedMessageCount
  )
}

function compareLastActivity(
  left: ClientConversation,
  right: ClientConversation
) {
  const difference = activityTimestamp(right) - activityTimestamp(left)
  return difference === 0 ? left.id.localeCompare(right.id) : difference
}

function activityTimestamp(conversation: ClientConversation) {
  const parsed = Date.parse(conversation.lastMessageAt ?? conversation.createdAt)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

function positiveSeq(value: number | null | undefined) {
  return value !== undefined && value !== null && value > 0 ? value : null
}
