import { databaseService, type DatabaseWriter } from "@/data/database/database-service"

import type {
  ClientMessage,
  ClientMessageList,
  MessageChoiceSnapshot,
  MessageChoiceUpdatedEvent,
  MessageReactionsUpdatedEvent,
  MessageReactionSnapshot,
} from "@/core/models"
import { applyChoiceMessageTombstone } from "@/data/messages/message-tombstones"
import type { AuthenticatedTarget, ServerTarget } from "@/core/server-target"
import { createServerKey } from "@/data/server-key"
import {
  applyMessageChoiceEvent,
  applyMessageChoiceSnapshot,
} from "@/domain/messages/message-choices"
import {
  applyMessageReactionsUpdate,
  applyMessageReactionSnapshot,
  preserveNewerMessageState,
} from "@/domain/messages/message-reactions"

const MAX_MESSAGES_PER_CONVERSATION = 3_000
const MAX_LOGICAL_CACHE_BYTES = 200 * 1024 * 1024
const MESSAGE_ROW_OVERHEAD_BYTES = 256
const CACHE_MAINTENANCE_INTERVAL_MS = 60_000

type CachedMessageRow = {
  payload_bytes: number
  payload_json: string
}

type CachedMessageIdentityRow = {
  message_id: string
}

type CacheStatsRow = {
  message_count: number
  payload_bytes: number
}

type SyncStateRow = {
  conversation_id: string
  has_more_before: number
  http_synced_through_seq: number
  last_accessed_at: number
  last_synced_at: number | null
  oldest_cached_seq: number | null
}

export type MessageSyncState = {
  conversationId: string
  hasMoreBefore: boolean
  httpSyncedThroughSeq: number
  lastAccessedAt: number
  lastSyncedAt: number | null
  oldestCachedSeq: number | null
}

export const createMessageServerKey = createServerKey

export async function readLatestCachedMessages(
  target: AuthenticatedTarget,
  conversationId: string,
  limit: number
) {
  return readCachedMessages(target, conversationId, { limit })
}

export async function readCachedMessagesBefore(
  target: AuthenticatedTarget,
  conversationId: string,
  beforeSeq: number,
  limit: number
) {
  return readCachedMessages(target, conversationId, { beforeSeq, limit })
}

export async function getMessageSyncState(
  target: AuthenticatedTarget,
  conversationId: string
): Promise<MessageSyncState | null> {
  const row = await databaseService.read("messages.sync-state.read", (database) => database.getFirst<SyncStateRow>(
    `SELECT conversation_id, http_synced_through_seq, oldest_cached_seq,
            has_more_before, last_synced_at, last_accessed_at
       FROM message_sync_state
      WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
    createMessageServerKey(target),
    target.userId,
    conversationId
  ))

  return row ? mapSyncState(row) : null
}

export async function listMessageSyncStates(
  target: AuthenticatedTarget
): Promise<MessageSyncState[]> {
  const rows = await databaseService.read("messages.sync-states.list", (database) => database.getAll<SyncStateRow>(
    `SELECT conversation_id, http_synced_through_seq, oldest_cached_seq,
            has_more_before, last_synced_at, last_accessed_at
       FROM message_sync_state
      WHERE server_key = ? AND user_id = ?`,
    createMessageServerKey(target),
    target.userId
  ))

  return rows.map(mapSyncState)
}

export async function persistRealtimeMessages(
  target: AuthenticatedTarget,
  messages: ClientMessage[]
) {
  if (messages.length === 0) return

  const grouped = groupMessagesByConversation(messages)
  await databaseService.transaction("messages.cache.transaction", async (transaction) => {
    for (const [conversationId, conversationMessages] of grouped) {
      await upsertMessages(transaction, target, conversationMessages)
      await ensureSyncState(transaction, target, conversationId, Date.now())
      await trimConversation(transaction, target, conversationId)
    }
  })
  scheduleMessageCacheMaintenance()
}

export async function persistLatestHttpPage(
  target: AuthenticatedTarget,
  conversationId: string,
  result: ClientMessageList
) {
  assertMessagesBelongToConversation(conversationId, result.messages)
  await databaseService.transaction("messages.cache.transaction", async (transaction) => {
    const now = Date.now()
    await upsertMessages(transaction, target, result.messages)
    const state = await readSyncStateRow(transaction, target, conversationId)
    const initializesCursor = (state?.http_synced_through_seq ?? 0) === 0
    const httpSyncedThroughSeq = initializesCursor
      ? result.page.newestSeq
      : state!.http_synced_through_seq

    await writeSyncState(transaction, target, conversationId, {
      hasMoreBefore: initializesCursor
        ? result.page.hasMoreBefore
        : state!.has_more_before !== 0,
      httpSyncedThroughSeq,
      lastAccessedAt: now,
      lastSyncedAt: initializesCursor
        ? (httpSyncedThroughSeq > 0 ? now : null)
        : state!.last_synced_at,
      oldestCachedSeq: minimumPositive(
        state?.oldest_cached_seq,
        result.page.oldestSeq
      ),
    })
    await trimConversation(transaction, target, conversationId)
  })
  scheduleMessageCacheMaintenance()
}

export async function persistBeforeHttpPage(
  target: AuthenticatedTarget,
  conversationId: string,
  requestedBeforeSeq: number,
  result: ClientMessageList
) {
  assertMessagesBelongToConversation(conversationId, result.messages)
  await databaseService.transaction("messages.cache.transaction", async (transaction) => {
    const state = await readSyncStateRow(transaction, target, conversationId)
    const updatesHistoryBoundary =
      !state ||
      state.http_synced_through_seq === 0 ||
      requestedBeforeSeq <= state.http_synced_through_seq + 1
    await upsertMessages(transaction, target, result.messages)
    await writeSyncState(transaction, target, conversationId, {
      hasMoreBefore: updatesHistoryBoundary
        ? result.page.hasMoreBefore
        : state.has_more_before !== 0,
      httpSyncedThroughSeq: state?.http_synced_through_seq ?? 0,
      lastAccessedAt: Date.now(),
      lastSyncedAt: state?.last_synced_at ?? null,
      oldestCachedSeq: updatesHistoryBoundary
        ? minimumPositive(state?.oldest_cached_seq, result.page.oldestSeq)
        : state.oldest_cached_seq,
    })
    await trimConversation(transaction, target, conversationId)
  })
  scheduleMessageCacheMaintenance()
}

export async function persistAfterHttpPage(
  target: AuthenticatedTarget,
  conversationId: string,
  requestedAfterSeq: number,
  result: ClientMessageList
) {
  assertMessagesBelongToConversation(conversationId, result.messages)
  let committedSeq = requestedAfterSeq
  await databaseService.transaction("messages.cache.transaction", async (transaction) => {
    const state = await readSyncStateRow(transaction, target, conversationId)
    const currentCursor = state?.http_synced_through_seq ?? requestedAfterSeq
    await upsertMessages(transaction, target, result.messages)

    // Only the exact next HTTP page may advance this durable cursor. A stale
    // concurrent response may add messages, but it must never skip a gap.
    if (currentCursor === requestedAfterSeq) {
      committedSeq = newestSeqAfter(requestedAfterSeq, result)
    } else {
      committedSeq = currentCursor
    }

    await writeSyncState(transaction, target, conversationId, {
      hasMoreBefore: state?.has_more_before !== 0,
      httpSyncedThroughSeq: committedSeq,
      lastAccessedAt: Date.now(),
      lastSyncedAt: Date.now(),
      oldestCachedSeq: minimumPositive(
        state?.oldest_cached_seq,
        result.page.oldestSeq
      ),
    })
    await trimConversation(transaction, target, conversationId)
  })
  scheduleMessageCacheMaintenance()
  return committedSeq
}

export async function persistMessageReactionSnapshot(
  target: AuthenticatedTarget,
  snapshot: MessageReactionSnapshot
) {
  await updatePersistedMessage(
    target,
    snapshot.conversationId,
    snapshot.messageId,
    (message) => applyMessageReactionSnapshot(message, snapshot)
  )
}

export async function persistMessageChoiceSnapshot(
  target: AuthenticatedTarget,
  snapshot: MessageChoiceSnapshot
) {
  if (snapshot.status === "deleted") {
    await removePersistedMessage(
      target,
      snapshot.conversationId,
      snapshot.messageId
    )
    return
  }
  await updatePersistedMessage(
    target,
    snapshot.conversationId,
    snapshot.messageId,
    (message) => applyMessageChoiceSnapshot(message, snapshot) ?? message
  )
}

export async function persistMessageChoiceEvent(
  target: AuthenticatedTarget,
  event: MessageChoiceUpdatedEvent
) {
  await updatePersistedMessage(
    target,
    event.conversationId,
    event.messageId,
    (message) => applyMessageChoiceEvent(message, event, target.userId)
  )
}

export async function persistMessageReactionsEvent(
  target: AuthenticatedTarget,
  event: MessageReactionsUpdatedEvent
): Promise<"applied" | "gap" | "missing" | "stale"> {
  const statusResult: {
    status: "applied" | "gap" | "missing" | "stale"
  } = { status: "missing" }
  await updatePersistedMessage(
    target,
    event.conversationId,
    event.messageId,
    (message) => {
      const reactionResult = applyMessageReactionsUpdate(
        message,
        event,
        target.userId
      )
      statusResult.status = reactionResult.status
      return reactionResult.message
    }
  )
  return statusResult.status
}

export async function removeConversationMessageCache(
  target: AuthenticatedTarget,
  conversationId: string
) {
  await databaseService.transaction("messages.cache.transaction", async (transaction) => {
    const serverKey = createMessageServerKey(target)
    await transaction.run(
      `DELETE FROM cached_messages
        WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
      serverKey,
      target.userId,
      conversationId
    )
    await transaction.run(
      `DELETE FROM message_sync_state
        WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
      serverKey,
      target.userId,
      conversationId
    )
    await transaction.run(
      `DELETE FROM message_cache_stats
        WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
      serverKey,
      target.userId,
      conversationId
    )
  })
}

export async function removeServerMessageCache(server: ServerTarget) {
  await databaseService.transaction("messages.cache.transaction", async (transaction) => {
    const serverKey = createMessageServerKey(server)
    await transaction.run(
      "DELETE FROM cached_messages WHERE server_key = ?",
      serverKey
    )
    await transaction.run(
      "DELETE FROM message_sync_state WHERE server_key = ?",
      serverKey
    )
    await transaction.run(
      "DELETE FROM message_cache_stats WHERE server_key = ?",
      serverKey
    )
  })
}

async function readCachedMessages(
  target: AuthenticatedTarget,
  conversationId: string,
  input: { beforeSeq?: number; limit: number }
) {
  const serverKey = createMessageServerKey(target)
  const rows = await databaseService.read("messages.page.read", async (database) => input.beforeSeq === undefined
    ? database.getAll<CachedMessageRow>(
        `SELECT payload_json FROM cached_messages
          WHERE server_key = ? AND user_id = ? AND conversation_id = ?
          ORDER BY seq DESC LIMIT ?`,
        serverKey,
        target.userId,
        conversationId,
        input.limit
      )
    : await database.getAll<CachedMessageRow>(
        `SELECT payload_json FROM cached_messages
          WHERE server_key = ? AND user_id = ? AND conversation_id = ?
            AND seq < ?
            AND seq >= COALESCE((
              SELECT oldest_cached_seq FROM message_sync_state
               WHERE server_key = ? AND user_id = ? AND conversation_id = ?
            ), 9223372036854775807)
          ORDER BY seq DESC LIMIT ?`,
        serverKey,
        target.userId,
        conversationId,
        input.beforeSeq,
        serverKey,
        target.userId,
        conversationId,
        input.limit
      ))

  void databaseService.write("messages.access.touch", (database) => database.run(
    `UPDATE message_sync_state SET last_accessed_at = ?
      WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
    Date.now(),
    serverKey,
    target.userId,
    conversationId
  )).catch(() => undefined)

  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row.payload_json) as ClientMessage]
    } catch {
      return []
    }
  })
}

async function upsertMessages(
  database: DatabaseWriter,
  target: AuthenticatedTarget,
  messages: ClientMessage[]
) {
  const serverKey = createMessageServerKey(target)
  const cachedAt = Date.now()

  for (const candidate of messages) {
    const incoming = applyChoiceMessageTombstone(target, candidate)
    if (!incoming) continue

    const existing = await database.getFirst<CachedMessageRow>(
      `SELECT payload_json,
              LENGTH(CAST(payload_json AS BLOB)) AS payload_bytes
         FROM cached_messages
        WHERE server_key = ? AND user_id = ? AND conversation_id = ?
          AND message_id = ?`,
      serverKey,
      target.userId,
      incoming.conversationId,
      incoming.id
    )
    const current = parseCachedMessage(existing?.payload_json)
    const message = current
      ? preserveNewerMessageState(current, incoming)
      : incoming

    // A server race or legacy bad row can assign one seq to two IDs. Keep the
    // already committed identity: replacing it could overwrite a newer or
    // reaction-enriched message, while skipping only the conflicting candidate
    // lets the rest of this page commit.
    const seqOwner = await database.getFirst<CachedMessageIdentityRow>(
      `SELECT message_id FROM cached_messages
        WHERE server_key = ? AND user_id = ? AND conversation_id = ? AND seq = ?`,
      serverKey,
      target.userId,
      message.conversationId,
      message.seq
    )
    if (seqOwner && seqOwner.message_id !== message.id) continue

    const payload = JSON.stringify(message)

    await database.run(
      `INSERT INTO cached_messages (
          server_key, user_id, conversation_id, message_id, seq,
          reaction_version, payload_json, created_at, cached_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(server_key, user_id, conversation_id, message_id)
        DO UPDATE SET
          seq = excluded.seq,
          reaction_version = excluded.reaction_version,
          payload_json = excluded.payload_json,
          created_at = excluded.created_at,
          cached_at = excluded.cached_at`,
      serverKey,
      target.userId,
      message.conversationId,
      message.id,
      message.seq,
      message.reactionVersion,
      payload,
      message.createdAt,
      cachedAt
    )
    await updateCacheStats(
      database,
      target,
      incoming.conversationId,
      existing ? 0 : 1,
      payload,
      -(existing?.payload_bytes ?? 0)
    )
  }
}

export async function updatePersistedMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string,
  update: (message: ClientMessage) => ClientMessage
) {
  await databaseService.transaction("messages.cache.transaction", async (transaction) => {
    const serverKey = createMessageServerKey(target)
    const row = await transaction.getFirst<CachedMessageRow>(
      `SELECT payload_json,
              LENGTH(CAST(payload_json AS BLOB)) AS payload_bytes
         FROM cached_messages
        WHERE server_key = ? AND user_id = ? AND conversation_id = ?
          AND message_id = ?`,
      serverKey,
      target.userId,
      conversationId,
      messageId
    )
    const current = parseCachedMessage(row?.payload_json)
    if (!current) return

    const message = update(current)
    if (message === current) return
    const payload = JSON.stringify(message)

    await transaction.run(
      `UPDATE cached_messages
          SET reaction_version = ?, payload_json = ?, cached_at = ?
        WHERE server_key = ? AND user_id = ? AND conversation_id = ?
          AND message_id = ?`,
      message.reactionVersion,
      payload,
      Date.now(),
      serverKey,
      target.userId,
      conversationId,
      messageId
    )
    await updateCacheStats(
      transaction,
      target,
      conversationId,
      0,
      payload,
      -(row?.payload_bytes ?? 0)
    )
  })
}

export async function removePersistedMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string
) {
  await databaseService.transaction("messages.cache.transaction", async (transaction) => {
    const serverKey = createMessageServerKey(target)
    const row = await transaction.getFirst<CachedMessageRow>(
      `SELECT payload_json,
              LENGTH(CAST(payload_json AS BLOB)) AS payload_bytes
         FROM cached_messages
        WHERE server_key = ? AND user_id = ? AND conversation_id = ?
          AND message_id = ?`,
      serverKey,
      target.userId,
      conversationId,
      messageId
    )
    if (!row) return

    await transaction.run(
      `DELETE FROM cached_messages
        WHERE server_key = ? AND user_id = ? AND conversation_id = ?
          AND message_id = ?`,
      serverKey,
      target.userId,
      conversationId,
      messageId
    )
    await updateCacheStatsByDelta(
      transaction,
      target,
      conversationId,
      -1,
      -row.payload_bytes
    )
    await transaction.run(
      `DELETE FROM message_cache_stats
        WHERE server_key = ? AND user_id = ? AND conversation_id = ?
          AND message_count = 0`,
      serverKey,
      target.userId,
      conversationId
    )
  })
}

async function ensureSyncState(
  database: DatabaseWriter,
  target: AuthenticatedTarget,
  conversationId: string,
  accessedAt: number
) {
  await database.run(
    `INSERT INTO message_sync_state (
       server_key, user_id, conversation_id, last_accessed_at
     ) VALUES (?, ?, ?, ?)
     ON CONFLICT(server_key, user_id, conversation_id)
     DO UPDATE SET last_accessed_at = excluded.last_accessed_at`,
    createMessageServerKey(target),
    target.userId,
    conversationId,
    accessedAt
  )
}

async function readSyncStateRow(
  database: DatabaseWriter,
  target: AuthenticatedTarget,
  conversationId: string
) {
  return database.getFirst<SyncStateRow>(
    `SELECT conversation_id, http_synced_through_seq, oldest_cached_seq,
            has_more_before, last_synced_at, last_accessed_at
       FROM message_sync_state
      WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
    createMessageServerKey(target),
    target.userId,
    conversationId
  )
}

async function writeSyncState(
  database: DatabaseWriter,
  target: AuthenticatedTarget,
  conversationId: string,
  state: Omit<MessageSyncState, "conversationId">
) {
  await database.run(
    `INSERT INTO message_sync_state (
       server_key, user_id, conversation_id, http_synced_through_seq,
       oldest_cached_seq, has_more_before, last_synced_at, last_accessed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_key, user_id, conversation_id) DO UPDATE SET
       http_synced_through_seq = excluded.http_synced_through_seq,
       oldest_cached_seq = excluded.oldest_cached_seq,
       has_more_before = excluded.has_more_before,
       last_synced_at = excluded.last_synced_at,
       last_accessed_at = excluded.last_accessed_at`,
    createMessageServerKey(target),
    target.userId,
    conversationId,
    state.httpSyncedThroughSeq,
    state.oldestCachedSeq,
    state.hasMoreBefore ? 1 : 0,
    state.lastSyncedAt,
    state.lastAccessedAt
  )
}

async function trimConversation(
  database: DatabaseWriter,
  target: AuthenticatedTarget,
  conversationId: string
) {
  const serverKey = createMessageServerKey(target)
  const previousState = await readSyncStateRow(
    database,
    target,
    conversationId
  )
  const stats = await readCacheStats(database, target, conversationId)
  if ((stats?.message_count ?? 0) > MAX_MESSAGES_PER_CONVERSATION) {
    const trimmed = await database.getFirst<CacheStatsRow>(
      `SELECT COUNT(*) AS message_count,
              COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0)
                AS payload_bytes
         FROM cached_messages
        WHERE server_key = ? AND user_id = ? AND conversation_id = ?
          AND message_id IN (
            SELECT message_id FROM cached_messages
             WHERE server_key = ? AND user_id = ? AND conversation_id = ?
             ORDER BY seq DESC LIMIT -1 OFFSET ?
          )`,
      serverKey,
      target.userId,
      conversationId,
      serverKey,
      target.userId,
      conversationId,
      MAX_MESSAGES_PER_CONVERSATION
    )
    await database.run(
      `DELETE FROM cached_messages
        WHERE server_key = ? AND user_id = ? AND conversation_id = ?
          AND message_id IN (
            SELECT message_id FROM cached_messages
             WHERE server_key = ? AND user_id = ? AND conversation_id = ?
             ORDER BY seq DESC LIMIT -1 OFFSET ?
          )`,
      serverKey,
      target.userId,
      conversationId,
      serverKey,
      target.userId,
      conversationId,
      MAX_MESSAGES_PER_CONVERSATION
    )
    await updateCacheStatsByDelta(
      database,
      target,
      conversationId,
      -(trimmed?.message_count ?? 0),
      -(trimmed?.payload_bytes ?? 0)
    )
  }
  const oldest = previousState?.oldest_cached_seq
    ? await database.getFirst<{ seq: number | null }>(
        `SELECT MIN(seq) AS seq FROM cached_messages
          WHERE server_key = ? AND user_id = ? AND conversation_id = ?
            AND seq >= ?`,
        serverKey,
        target.userId,
        conversationId,
        previousState.oldest_cached_seq
      )
    : null
  const oldestCachedSeq = oldest?.seq ?? null
  const historyWasTrimmed = Boolean(
    previousState?.oldest_cached_seq &&
      (!oldestCachedSeq || oldestCachedSeq > previousState.oldest_cached_seq)
  )
  await database.run(
    `UPDATE message_sync_state
        SET oldest_cached_seq = ?,
            has_more_before = CASE WHEN ? = 1 THEN 1 ELSE has_more_before END
      WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
    oldestCachedSeq,
    historyWasTrimmed ? 1 : 0,
    serverKey,
    target.userId,
    conversationId
  )
}

let maintenancePromise: Promise<void> | null = null
let lastMaintenanceAt = 0

function scheduleMessageCacheMaintenance() {
  if (
    maintenancePromise ||
    Date.now() - lastMaintenanceAt < CACHE_MAINTENANCE_INTERVAL_MS
  ) {
    return
  }

  maintenancePromise = runMessageCacheMaintenance()
    .catch(() => undefined)
    .finally(() => {
      lastMaintenanceAt = Date.now()
      maintenancePromise = null
    })
}

export async function waitForMessageCacheMaintenance() {
  while (maintenancePromise) await maintenancePromise
}

async function runMessageCacheMaintenance() {
  await databaseService.transaction("messages.cache.transaction", async (transaction) => {
    let size = await getLogicalCacheSize(transaction)
    while (size > MAX_LOGICAL_CACHE_BYTES) {
      const oldest = await transaction.getFirst<{
        conversation_id: string
        message_count: number
        payload_bytes: number
        server_key: string
        user_id: string
      }>(
        `SELECT stats.server_key, stats.user_id, stats.conversation_id,
                stats.message_count, stats.payload_bytes
           FROM message_cache_stats stats
           LEFT JOIN message_sync_state state
             ON state.server_key = stats.server_key
            AND state.user_id = stats.user_id
            AND state.conversation_id = stats.conversation_id
          ORDER BY COALESCE(state.last_accessed_at, 0) ASC LIMIT 1`
      )
      if (!oldest) return

      await transaction.run(
        `DELETE FROM cached_messages
          WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
        oldest.server_key,
        oldest.user_id,
        oldest.conversation_id
      )
      await transaction.run(
        `DELETE FROM message_sync_state
          WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
        oldest.server_key,
        oldest.user_id,
        oldest.conversation_id
      )
      await transaction.run(
        `DELETE FROM message_cache_stats
          WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
        oldest.server_key,
        oldest.user_id,
        oldest.conversation_id
      )
      size -=
        oldest.payload_bytes +
        oldest.message_count * MESSAGE_ROW_OVERHEAD_BYTES
    }
  })
  await databaseService.maintenance("messages.cache.optimize", (database) =>
    database.exec("PRAGMA optimize; PRAGMA wal_checkpoint(PASSIVE);")
  ).catch(() => undefined)
}

async function getLogicalCacheSize(database: DatabaseWriter) {
  const result = await database.getFirst<{
    logical_bytes: number
  }>(
    `SELECT COALESCE(
              SUM(payload_bytes + message_count * ?),
              0
            ) AS logical_bytes
       FROM message_cache_stats`,
    MESSAGE_ROW_OVERHEAD_BYTES
  )
  return result?.logical_bytes ?? 0
}

async function readCacheStats(
  database: DatabaseWriter,
  target: AuthenticatedTarget,
  conversationId: string
) {
  return database.getFirst<CacheStatsRow>(
    `SELECT message_count, payload_bytes
       FROM message_cache_stats
      WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
    createMessageServerKey(target),
    target.userId,
    conversationId
  )
}

async function updateCacheStats(
  database: DatabaseWriter,
  target: AuthenticatedTarget,
  conversationId: string,
  messageCountDelta: number,
  payload: string,
  previousPayloadBytesDelta: number
) {
  await database.run(
    `INSERT INTO message_cache_stats (
       server_key, user_id, conversation_id, message_count, payload_bytes
     ) VALUES (?, ?, ?, ?, LENGTH(CAST(? AS BLOB)) + ?)
     ON CONFLICT(server_key, user_id, conversation_id) DO UPDATE SET
       message_count = MAX(0, message_count + excluded.message_count),
       payload_bytes = MAX(0, payload_bytes + excluded.payload_bytes)`,
    createMessageServerKey(target),
    target.userId,
    conversationId,
    messageCountDelta,
    payload,
    previousPayloadBytesDelta
  )
}

async function updateCacheStatsByDelta(
  database: DatabaseWriter,
  target: AuthenticatedTarget,
  conversationId: string,
  messageCountDelta: number,
  payloadBytesDelta: number
) {
  await database.run(
    `UPDATE message_cache_stats
        SET message_count = MAX(0, message_count + ?),
            payload_bytes = MAX(0, payload_bytes + ?)
      WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
    messageCountDelta,
    payloadBytesDelta,
    createMessageServerKey(target),
    target.userId,
    conversationId
  )
}

function assertMessagesBelongToConversation(
  conversationId: string,
  messages: ClientMessage[]
) {
  const mismatched = messages.find(
    (message) => message.conversationId !== conversationId
  )
  if (mismatched) {
    throw new Error(
      `消息缓存会话不一致: expected=${conversationId}, actual=${mismatched.conversationId}`
    )
  }
}

function groupMessagesByConversation(messages: ClientMessage[]) {
  const grouped = new Map<string, ClientMessage[]>()
  for (const message of messages) {
    const current = grouped.get(message.conversationId) ?? []
    current.push(message)
    grouped.set(message.conversationId, current)
  }
  return grouped
}

function mapSyncState(row: SyncStateRow): MessageSyncState {
  return {
    conversationId: row.conversation_id,
    hasMoreBefore: row.has_more_before !== 0,
    httpSyncedThroughSeq: row.http_synced_through_seq,
    lastAccessedAt: row.last_accessed_at,
    lastSyncedAt: row.last_synced_at,
    oldestCachedSeq: row.oldest_cached_seq,
  }
}

function minimumPositive(...values: (number | null | undefined)[]) {
  const positive = values.filter(
    (value): value is number => Boolean(value && value > 0)
  )
  return positive.length > 0 ? Math.min(...positive) : null
}

function newestSeqAfter(afterSeq: number, result: ClientMessageList) {
  return result.messages.reduce(
    (newest, message) => Math.max(newest, message.seq),
    afterSeq
  )
}

function parseCachedMessage(value: string | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value) as ClientMessage
  } catch {
    return null
  }
}
