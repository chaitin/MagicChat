import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react"
import { DirectorySynchronizer, directoryUpdatedEvent } from "../../../shared/directory-sync"
import { EntitySynchronizer, entityChangeEvents, entityKey, parseEntityChange, type EntityReference } from "../../../shared/entity-sync"
import { resolveClientEntities } from "@/lib/client-api/entity-sync"
import { useClientData } from "@/lib/client-data-context"
import { useRealtime } from "@/lib/realtime-context"

export function ClientEntityRealtimeSync() {
  const { applyEntitySnapshot, contactGroups, conversations, me, refreshContacts, usersById } = useClientData()
  const { ready, subscribeRealtimeEvent } = useRealtime()
  const syncRef = useRef<EntitySynchronizer<Awaited<ReturnType<typeof resolveClientEntities>>> | null>(null)
  const directoryRef = useRef<DirectorySynchronizer | null>(null)
  const reconciliationRef = useRef<{
    sync: EntitySynchronizer<Awaited<ReturnType<typeof resolveClientEntities>>>
    initialized: boolean
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
  const knownGroups = useEffectEvent((): EntityReference[] => [
    ...[...new Set([...contactGroups.filter((group) => group.joined).map((group) => group.id), ...conversations.filter((item) => item.type === "group").map((item) => item.id)])].map((id) => ({ type: "group" as const, id })),
  ])

  const reconcile = useEffectEvent(async () => {
    if (!ready) return
    const sync = syncRef.current
    const reconciliation = reconciliationRef.current
    if (!sync || reconciliation?.sync !== sync) return
    if (reconciliation.work) return reconciliation.work
    const work = (async () => {
      // Bootstrap already loaded the directory and user profiles before mounting us.
      if (reconciliation.initialized) await refreshDirectory({ forceUsers: true })
      reconciliation.initialized = true
      if (syncRef.current === sync) await sync.refresh(knownGroups())
    })().finally(() => { if (reconciliation.work === work) reconciliation.work = undefined })
    reconciliation.work = work
    return work
  })

  useEffect(() => {
    if (!accountId) return
    let active = true
    const sync = new EntitySynchronizer({
      resolve: resolveClientEntities,
      version: (snapshot, entity) => snapshot.versions[entityKey(entity)] ?? null,
      apply: async (snapshot, entities, isCurrent) => apply(snapshot, entities, isCurrent),
      isCurrent: () => active && currentAccountRef.current === accountId,
      onError: (error) => console.warn("同步实体资料失败", error),
    })
    const directory = new DirectorySynchronizer({
      refresh: () => refreshDirectory(),
      isCurrent: () => active && currentAccountRef.current === accountId,
      onError: (error) => console.warn("同步通讯录失败", error),
    })
    syncRef.current = sync
    directoryRef.current = directory
    reconciliationRef.current = { sync, initialized: false }
    const unsubscribers = entityChangeEvents.map((event) => subscribeRealtimeEvent(event, (payload) => {
      const change = parseEntityChange(event, payload)
      if (change && loaded(change.entity)) sync.notify(event, payload)
    }))
    unsubscribers.push(subscribeRealtimeEvent(directoryUpdatedEvent, (payload) => {
      directory.notify(directoryUpdatedEvent, payload)
    }))
    unsubscribers.push(subscribeRealtimeEvent("conversation.removed", (payload) => {
      if (!payload || typeof payload !== "object" || !("conversation_id" in payload) || typeof payload.conversation_id !== "string") return
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
  return null
}
