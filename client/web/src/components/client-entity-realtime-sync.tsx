import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react"
import { GroupProfileSyncCache } from "../../../shared/group-profile-sync-cache"
import { createWebGroupProfileStore, hasCompleteGroupProfile, type GroupEntitySnapshot } from "@/lib/group-profile-cache"
import { DirectorySynchronizer, directoryUpdatedEvent } from "../../../shared/directory-sync"
import { EntitySynchronizer, entityChangeEvents, entityKey, parseEntityChange, type EntityReference } from "../../../shared/entity-sync"
import { resolveClientEntities } from "@/lib/client-api/entity-sync"
import { useClientData } from "@/lib/client-data-context"
import { useRealtime } from "@/lib/realtime-context"

export function ClientEntityRealtimeSync() {
  const { applyEntitySnapshot, contactGroups, conversations, foregroundConversationId, me, refreshContacts, usersById } = useClientData()
  const { ready, subscribeRealtimeEvent } = useRealtime()
  const syncRef = useRef<EntitySynchronizer<Awaited<ReturnType<typeof resolveClientEntities>>> | null>(null)
  const directoryRef = useRef<DirectorySynchronizer | null>(null)
  const reconciliationRef = useRef<{
    sync: EntitySynchronizer<Awaited<ReturnType<typeof resolveClientEntities>>>
    initialized: boolean
    restore: (entities: EntityReference[]) => Promise<void>
    work?: Promise<void>
  } | null>(null)
  const accountId = me?.id
  // Snapshot guards also run inside state updaters, where Effect Events are forbidden.
  const currentAccountRef = useRef(accountId)
  useLayoutEffect(() => {
    currentAccountRef.current = accountId
  }, [accountId])
  const apply = useEffectEvent(applyEntitySnapshot)
  const refreshDirectory = useEffectEvent(refreshContacts)
  const loaded = useEffectEvent((entity: EntityReference) => entity.type !== "user" || entity.id === me?.id || Boolean(usersById[entity.id]))
  const knownGroups = useEffectEvent((groups = contactGroups): EntityReference[] => [
    ...[...new Set([...groups.filter((group) => group.joined).map((group) => group.id), ...conversations.filter((item) => item.type === "group").map((item) => item.id)])].map((id) => ({ type: "group" as const, id })),
  ])

  const reconcile = useEffectEvent(async () => {
    if (!ready) return
    const sync = syncRef.current
    const reconciliation = reconciliationRef.current
    if (!sync || reconciliation?.sync !== sync) return
    if (reconciliation.work) return reconciliation.work
    const work = (async () => {
      const groups = await refreshDirectory({ forceUsers: reconciliation.initialized })
      const entities = knownGroups(groups || undefined)
      if (syncRef.current !== sync) return
      if (!reconciliation.initialized) await reconciliation.restore(entities)
      reconciliation.initialized = true
      if (syncRef.current === sync) await sync.refresh(entities, { useCache: true })
    })().finally(() => { if (reconciliation.work === work) reconciliation.work = undefined })
    reconciliation.work = work
    return work
  })

  useEffect(() => {
    if (!accountId) return
    let active = true
    const current = () => active && currentAccountRef.current === accountId
    const store = createWebGroupProfileStore(accountId)
    const snapshots = new Map<string, GroupEntitySnapshot>()
    const changed = new Set<string>()
    const cache = new GroupProfileSyncCache({
      isCurrent: current,
      onError: (error) => console.warn("更新群资料缓存失败", error),
      read: async (ids) => (await store.read(ids)).map((record) => ({
        id: record.id, syncedAt: record.syncedAt, hasSnapshot: hasCompleteGroupProfile(record),
      })),
      write: async (ids, syncedAt) => {
        if (!current()) return
        await store.write(ids.flatMap((id) => {
          const snapshot = snapshots.get(id)
          return snapshot ? [{ id, syncedAt, snapshot }] : []
        }))
      },
      remove: (ids) => store.remove(ids),
    })
    const sync = new EntitySynchronizer({
      groupCache: cache,
      resolve: resolveClientEntities,
      version: (snapshot, entity) => snapshot.versions[entityKey(entity)] ?? null,
      apply: async (snapshot, entities, isCurrent) => {
        const application = await apply(snapshot, entities, isCurrent)
        const syncedGroups: string[] = []
        for (const entity of entities) {
          if (entity.type !== "group" || !isCurrent(entity)) continue
          if (application && !application.syncedGroups.includes(entity.id) && snapshot.conversations.some((item) => item.id === entity.id)) continue
          changed.add(entity.id)
          const saved: GroupEntitySnapshot = {
            users: [], apps: [], removed: [], versions: { [entityKey(entity)]: snapshot.versions[entityKey(entity)] ?? 0 },
            groups: (snapshot.groups ?? []).filter((group) => group.id === entity.id),
            conversations: (snapshot.conversations ?? []).filter((group) => group.id === entity.id),
          }
          if (hasCompleteGroupProfile({ id: entity.id, syncedAt: 0, snapshot: saved })) {
            snapshots.set(entity.id, saved)
            syncedGroups.push(entity.id)
          }
          else { snapshots.delete(entity.id); cache.invalidate(entity.id) }
        }
        return { syncedGroups }
      },
      isCurrent: current,
      onError: (error) => console.warn("同步实体资料失败", error),
    })
    const directory = new DirectorySynchronizer({
      refresh: async () => { await refreshDirectory() },
      isCurrent: () => active && currentAccountRef.current === accountId,
      onError: (error) => console.warn("同步通讯录失败", error),
    })
    syncRef.current = sync
    directoryRef.current = directory
    reconciliationRef.current = {
      sync, initialized: false,
      restore: async (entities) => {
        const records = await store.read(entities.map((entity) => entity.id))
        for (const record of records) {
          if (!current()) return
          if (changed.has(record.id)) continue
          apply(record.snapshot, [{ type: "group", id: record.id }],
            (entity) => current() && !changed.has(entity.id))
        }
      },
    }
    const unsubscribers = entityChangeEvents.map((event) => subscribeRealtimeEvent(event, (payload) => {
      const change = parseEntityChange(event, payload)
      if (change && loaded(change.entity)) {
        if (change.entity.type === "group") changed.add(change.entity.id)
        sync.notify(event, payload)
      }
    }))
    unsubscribers.push(subscribeRealtimeEvent(directoryUpdatedEvent, (payload) => {
      directory.notify(directoryUpdatedEvent, payload)
    }))
    unsubscribers.push(subscribeRealtimeEvent("conversation.removed", (payload) => {
      if (!payload || typeof payload !== "object" || !("conversation_id" in payload) || typeof payload.conversation_id !== "string") return
      changed.add(payload.conversation_id)
      sync.forget({ type: "group", id: payload.conversation_id })
      sync.notify("conversation.updated", { conversation_id: payload.conversation_id })
    }))
    const foreground = () => {
      if (document.visibilityState === "visible") void reconcile().catch(() => undefined)
    }
    document.addEventListener("visibilitychange", foreground)
    return () => {
      active = false
      sync.dispose()
      directory.dispose()
      void store.close()
      if (syncRef.current === sync) syncRef.current = null
      if (directoryRef.current === directory) directoryRef.current = null
      if (reconciliationRef.current?.sync === sync) reconciliationRef.current = null
      for (const unsubscribe of unsubscribers) unsubscribe()
      document.removeEventListener("visibilitychange", foreground)
    }
  }, [accountId, subscribeRealtimeEvent])

  useEffect(() => {
    if (ready) void reconcile().catch(() => undefined)
  }, [ready, accountId])
  const foreground = conversations.find((conversation) => conversation.id === foregroundConversationId)
  const activeGroupId = foreground?.type === "group" ? foreground.id :
    foreground?.type === "topic" && foreground.topic?.parentConversationType === "group"
      ? foreground.topic.parentConversationId : ""
  useEffect(() => {
    if (!ready || !activeGroupId) return
    const refresh = () => { void syncRef.current?.refresh([{ type: "group", id: activeGroupId }]).catch(() => undefined) }
    const foreground = () => { if (document.visibilityState === "visible") refresh() }
    refresh()
    document.addEventListener("visibilitychange", foreground)
    return () => document.removeEventListener("visibilitychange", foreground)
  }, [ready, accountId, activeGroupId, foregroundConversationId])
  return null
}
