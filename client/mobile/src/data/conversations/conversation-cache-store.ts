import type { ClientConversation } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import type { DatabaseService } from "@/data/database/database-service"
import { createServerKey } from "@/data/server-key"

type UpsertOptions = {
  observedAt: number
  source: "http" | "mutation"
  startedAt?: number
}

export type ConversationPatch =
  | Partial<ClientConversation>
  | ((current: ClientConversation) => Partial<ClientConversation>)

type StoredConversation = {
  conversation: ClientConversation | null
  observedAt: number
  tombstoneAt: number | null
}

export type ConversationCacheStore = {
  list(target: AuthenticatedTarget): Promise<ClientConversation[]>
  get(
    target: AuthenticatedTarget,
    conversationId: string
  ): Promise<ClientConversation | null>
  upsertBatch(
    target: AuthenticatedTarget,
    conversations: ClientConversation[],
    options: UpsertOptions
  ): Promise<void>
  patch(
    target: AuthenticatedTarget,
    conversationId: string,
    patch: ConversationPatch,
    options: UpsertOptions
  ): Promise<boolean>
  tombstone(
    target: AuthenticatedTarget,
    conversationIds: string[],
    observedAt: number
  ): Promise<void>
  treeIds(target: AuthenticatedTarget, rootId: string): Promise<string[]>
}

const MONOTONIC_FIELDS = [
  "lastReadSeq",
  "lastMentionedSeq",
  "lastChoiceSeq",
  "lastMessageSeq",
] as const

export function createConversationServerKey(target: AuthenticatedTarget) {
  return createServerKey(target)
}

function targetKey(target: AuthenticatedTarget) {
  return JSON.stringify([createConversationServerKey(target), target.userId])
}

function monotonicNumber(current: unknown, incoming: unknown) {
  const oldValue =
    typeof current === "number" && Number.isFinite(current) ? current : 0
  const newValue =
    typeof incoming === "number" && Number.isFinite(incoming) ? incoming : 0
  return Math.max(oldValue, newValue)
}

function mergeConversation(
  current: ClientConversation | null,
  incoming: ClientConversation
): ClientConversation {
  if (!current) return incoming

  const definedIncoming = Object.fromEntries(
    Object.entries(incoming).filter(([, value]) => value !== undefined)
  ) as Partial<ClientConversation>
  const merged = { ...current, ...definedIncoming } as ClientConversation
  for (const field of MONOTONIC_FIELDS) {
    merged[field] = monotonicNumber(current[field], incoming[field])
  }
  if (incoming.lastMessageSeq < current.lastMessageSeq) {
    merged.lastMessageAt = current.lastMessageAt
    merged.lastMessageId = current.lastMessageId
    merged.lastMessageSender = current.lastMessageSender
    merged.lastMessageSummary = current.lastMessageSummary
  }
  return merged
}

function resolvePatch(
  current: ClientConversation,
  patch: ConversationPatch
) {
  return typeof patch === "function" ? patch(current) : patch
}

function parseConversation(payload: string): ClientConversation | null {
  try {
    const value = JSON.parse(payload) as unknown
    if (!value || typeof value !== "object") return null
    const id = (value as { id?: unknown }).id
    return typeof id === "string" && id.length > 0
      ? (value as ClientConversation)
      : null
  } catch {
    return null
  }
}

function shouldIgnoreWrite(
  existing: StoredConversation | undefined,
  startedAt: number
) {
  return (existing?.observedAt ?? 0) > startedAt
}

export function createMemoryConversationCacheStore(): ConversationCacheStore {
  const targets = new Map<string, Map<string, StoredConversation>>()

  function records(target: AuthenticatedTarget) {
    const key = targetKey(target)
    const existing = targets.get(key)
    if (existing) return existing
    const created = new Map<string, StoredConversation>()
    targets.set(key, created)
    return created
  }

  return {
    async list(target) {
      return [...records(target).values()]
        .filter(
          (
            record
          ): record is StoredConversation & {
            conversation: ClientConversation
          } => record.tombstoneAt === null && record.conversation !== null
        )
        .map((record) => record.conversation)
    },

    async get(target, conversationId) {
      const record = records(target).get(conversationId)
      return record?.tombstoneAt === null ? record.conversation : null
    },

    async upsertBatch(target, conversations, options) {
      const store = records(target)
      for (const incoming of conversations) {
        const existing = store.get(incoming.id)
        if (
          shouldIgnoreWrite(existing, options.startedAt ?? options.observedAt)
        ) {
          continue
        }
        store.set(incoming.id, {
          conversation: mergeConversation(
            existing?.conversation ?? null,
            incoming
          ),
          observedAt: options.observedAt,
          tombstoneAt: null,
        })
      }
    },

    async patch(target, conversationId, patch, options) {
      const existing = records(target).get(conversationId)
      if (!existing?.conversation || existing.tombstoneAt !== null) return false
      const incoming = {
        ...existing.conversation,
        ...resolvePatch(existing.conversation, patch),
      }
      await this.upsertBatch(target, [incoming], options)
      return true
    },

    async tombstone(target, conversationIds, observedAt) {
      const store = records(target)
      for (const conversationId of conversationIds) {
        const existing = store.get(conversationId)
        store.set(conversationId, {
          conversation: existing?.conversation ?? null,
          observedAt: Math.max(existing?.observedAt ?? 0, observedAt),
          tombstoneAt: observedAt,
        })
      }
    },

    async treeIds(target, rootId) {
      const all = [...records(target).entries()]
      return collectTreeIds(
        rootId,
        all.map(([id, record]) => ({ id, conversation: record.conversation }))
      )
    },
  }
}

export function createSQLiteConversationCacheStore(injectedService?: DatabaseService): ConversationCacheStore {
  const fallback = createMemoryConversationCacheStore()

  async function database() {
    if (injectedService) return injectedService
    const module = await import("@/data/database/database-service")
    return module.isDatabasePersistenceAvailable ? module.databaseService : null
  }

  return {
    async list(target) {
      const service = await database()
      if (!service) return fallback.list(target)
      const rows = await service.read("conversations.list", (db) => db.getAll<{ payload_json: string }>(
        `SELECT payload_json FROM cached_conversations
         WHERE server_key = ? AND user_id = ? AND tombstone_at IS NULL
         ORDER BY pinned DESC, last_activity_at DESC`,
        [createConversationServerKey(target), target.userId]
      ))
      return rows.flatMap((row) => {
        const conversation = parseConversation(row.payload_json)
        return conversation ? [conversation] : []
      })
    },

    async get(target, conversationId) {
      const service = await database()
      if (!service) return fallback.get(target, conversationId)
      const row = await service.read("conversations.get", (db) => db.getFirst<{
        payload_json: string
        tombstone_at: number | null
      }>(
        `SELECT payload_json, tombstone_at FROM cached_conversations
         WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
        [createConversationServerKey(target), target.userId, conversationId]
      ))
      return row?.tombstone_at === null
        ? parseConversation(row.payload_json)
        : null
    },

    async upsertBatch(target, conversations, options) {
      const service = await database()
      if (!service) return fallback.upsertBatch(target, conversations, options)
      await service.transaction("conversations.upsert-batch", async (transaction) => {
        for (const incoming of conversations) {
          const row = await transaction.getFirst<{
            payload_json: string
            observed_at: number
            tombstone_at: number | null
          }>(
            `SELECT payload_json, observed_at, tombstone_at
             FROM cached_conversations
             WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
            [createConversationServerKey(target), target.userId, incoming.id]
          )
          const existing: StoredConversation | undefined = row
            ? {
                conversation: parseConversation(row.payload_json),
                observedAt: row.observed_at,
                tombstoneAt: row.tombstone_at,
              }
            : undefined
          if (
            shouldIgnoreWrite(existing, options.startedAt ?? options.observedAt)
          ) {
            continue
          }
          const merged = mergeConversation(
            existing?.conversation ?? null,
            incoming
          )
          const tombstoneAt = null
          await transaction.run(
            `INSERT OR REPLACE INTO cached_conversations (
               server_key, user_id, conversation_id, parent_conversation_id,
               conversation_type, last_activity_at, pinned, muted, unread_count,
               tombstone_at, observed_at, cached_at, payload_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [createConversationServerKey(target), target.userId, merged.id,
             merged.topic?.parentConversationId || null, merged.type, merged.lastMessageAt,
             merged.pinned ? 1 : 0, merged.notificationMuted ? 1 : 0, merged.unreadCount,
             tombstoneAt, options.observedAt, Date.now(), JSON.stringify(merged)]
          )
        }
      })
    },

    async patch(target, conversationId, patch, options) {
      const service = await database()
      if (!service) return fallback.patch(target, conversationId, patch, options)
      let updated = false
      await service.transaction("conversations.patch", async (transaction) => {
        const row = await transaction.getFirst<{
          payload_json: string
          tombstone_at: number | null
        }>(
          `SELECT payload_json, tombstone_at FROM cached_conversations
           WHERE server_key = ? AND user_id = ? AND conversation_id = ?`,
          [createConversationServerKey(target), target.userId, conversationId]
        )
        const current =
          row?.tombstone_at === null ? parseConversation(row.payload_json) : null
        if (!current) return

        const merged = mergeConversation(current, {
          ...current,
          ...resolvePatch(current, patch),
        })
        await transaction.run(
          `UPDATE cached_conversations SET
             parent_conversation_id = ?, conversation_type = ?,
             last_activity_at = ?, pinned = ?, muted = ?, unread_count = ?,
             tombstone_at = NULL, observed_at = ?, cached_at = ?, payload_json = ?
           WHERE server_key = ? AND user_id = ? AND conversation_id = ?
             AND tombstone_at IS NULL`,
          [merged.topic?.parentConversationId || null, merged.type, merged.lastMessageAt,
           merged.pinned ? 1 : 0, merged.notificationMuted ? 1 : 0, merged.unreadCount,
           options.observedAt, Date.now(), JSON.stringify(merged),
           createConversationServerKey(target), target.userId, conversationId]
        )
        updated = true
      })
      return updated
    },

    async tombstone(target, conversationIds, observedAt) {
      const service = await database()
      if (!service) return fallback.tombstone(target, conversationIds, observedAt)
      await service.transaction("conversations.tombstone", async (transaction) => {
        for (const conversationId of conversationIds) {
          await transaction.run(
            `INSERT INTO cached_conversations (
               server_key, user_id, conversation_id, conversation_type,
               pinned, muted, unread_count, tombstone_at, observed_at,
               cached_at, payload_json
             ) VALUES (?, ?, ?, 'unknown', 0, 0, 0, ?, ?, ?, 'null')
             ON CONFLICT(server_key, user_id, conversation_id)
             DO UPDATE SET
               tombstone_at = excluded.tombstone_at,
               observed_at = MAX(cached_conversations.observed_at, excluded.observed_at)`,
            [createConversationServerKey(target), target.userId, conversationId,
             observedAt, observedAt, Date.now()]
          )
        }
      })
    },

    async treeIds(target, rootId) {
      const service = await database()
      if (!service) return fallback.treeIds(target, rootId)
      const rows = await service.read("conversations.tree-ids", (db) => db.getAll<{
        conversation_id: string
        payload_json: string
      }>(
        `SELECT conversation_id, payload_json FROM cached_conversations
         WHERE server_key = ? AND user_id = ?`,
        [createConversationServerKey(target), target.userId]
      ))
      return collectTreeIds(
        rootId,
        rows.map((row) => ({
          id: row.conversation_id,
          conversation: parseConversation(row.payload_json),
        }))
      )
    },
  }
}

function collectTreeIds(
  rootId: string,
  rows: { id: string; conversation: ClientConversation | null }[]
) {
  const ids = new Set([rootId])
  let found = true
  while (found) {
    found = false
    for (const row of rows) {
      const parentId = row.conversation?.topic?.parentConversationId
      if (parentId && ids.has(parentId) && !ids.has(row.id)) {
        ids.add(row.id)
        found = true
      }
    }
  }
  return [...ids]
}

export const conversationCacheStore = createSQLiteConversationCacheStore()
