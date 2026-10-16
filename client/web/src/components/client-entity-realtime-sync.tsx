import { useEffect, useEffectEvent, useRef } from "react"
import { DirectorySynchronizer, directoryUpdatedEvent } from "../../../shared/directory-sync"
import { EntitySynchronizer, entityChangeEvents, entityKey, parseEntityChange, type EntityReference } from "../../../shared/entity-sync"
import { resolveClientEntities } from "@/lib/client-api/entity-sync"
import { useClientData } from "@/lib/client-data-context"
import { useRealtime } from "@/lib/realtime-context"

export function ClientEntityRealtimeSync() {
  const { applyEntitySnapshot, contactApps, contactGroups, conversations, me, refreshContacts, usersById } = useClientData()
  const { ready, subscribeRealtimeEvent } = useRealtime()
  const syncRef = useRef<EntitySynchronizer<Awaited<ReturnType<typeof resolveClientEntities>>> | null>(null)
  const directoryRef = useRef<DirectorySynchronizer | null>(null)
  const accountId = me?.id
  const currentAccount = useEffectEvent(() => accountId)
  const apply = useEffectEvent(applyEntitySnapshot)
  const refreshDirectory = useEffectEvent(refreshContacts)
  const loaded = useEffectEvent((entity: EntityReference) => entity.type !== "user" || entity.id === me?.id || Boolean(usersById[entity.id]))
  const known = useEffectEvent((): EntityReference[] => [
    ...[...new Set([...(me ? [me.id] : []), ...Object.keys(usersById)])].map((id) => ({ type: "user" as const, id })),
    ...contactApps.map(({ id }) => ({ type: "app" as const, id })),
    ...[...new Set([...contactGroups.filter((group) => group.joined).map((group) => group.id), ...conversations.filter((item) => item.type === "group").map((item) => item.id)])].map((id) => ({ type: "group" as const, id })),
  ])

  const reconcile = useEffectEvent(async () => {
    const sync = syncRef.current
    const directory = directoryRef.current
    if (!sync || !directory) return
    await directory.refresh()
    if (syncRef.current === sync) await sync.refresh(known())
  })

  useEffect(() => {
    if (!accountId) return
    let active = true
    const sync = new EntitySynchronizer({
      resolve: resolveClientEntities,
      version: (snapshot, entity) => snapshot.versions[entityKey(entity)] ?? null,
      apply: async (snapshot, entities, isCurrent) => apply(snapshot, entities, isCurrent),
      isCurrent: () => active && currentAccount() === accountId,
      onError: (error) => console.warn("同步实体资料失败", error),
    })
    const directory = new DirectorySynchronizer({
      refresh: () => refreshDirectory(),
      isCurrent: () => active && currentAccount() === accountId,
      onError: (error) => console.warn("同步通讯录失败", error),
    })
    syncRef.current = sync
    directoryRef.current = directory
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
      for (const unsubscribe of unsubscribers) unsubscribe()
      document.removeEventListener("visibilitychange", foreground)
    }
  }, [accountId, subscribeRealtimeEvent])

  useEffect(() => {
    if (ready) void reconcile().catch(() => undefined)
  }, [ready, accountId])
  return null
}
