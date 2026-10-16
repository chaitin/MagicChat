import type { QueryClient } from "@tanstack/react-query"
import { DirectorySynchronizer } from "../../../shared/directory-sync"
import { EntitySynchronizer, entityKey, parseEntityChange, type EntityReference } from "../../../shared/entity-sync"
import type { AuthenticatedTarget } from "@/core/server-target"
import type { ClientUser } from "@/core/models"
import { contactManager } from "@/data/contacts"
import { resolveClientEntities } from "@/data/contacts/entity-sync-api"
import { conversationManager } from "@/data/conversations"
import { queryKeys } from "@/data/query"
import { messageManager } from "@/data/messages/message-manager"

export function createMobileEntitySync(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  options: { isCurrent: () => boolean; onError: (error: unknown) => void },
) {
  const directorySync = new DirectorySynchronizer({
    ...options,
    refresh: async () => {
      const snapshot = await contactManager.refresh(target)
      if (!options.isCurrent()) return
      const missing = snapshot.directory.userIds.filter((id) => !snapshot.usersById[id] || snapshot.unavailableUserIds.has(id))
      // A newly activated user may still have a negative profile cache entry.
      if (missing.length) await contactManager.refreshUsers(target, missing)
      if (options.isCurrent()) await contactManager.ensureUsers(target, snapshot.directory.userIds)
    },
  })
  const sync = new EntitySynchronizer({
    ...options,
    resolve: async (entities) => {
      const startedAt = conversationManager.beginOperation(target)
      return { ...await resolveClientEntities(target, entities), startedAt }
    },
    version: (snapshot, entity) => snapshot.versions[entityKey(entity)] ?? null,
    apply: async (snapshot, entities, isCurrent) => {
      await contactManager.applyEntities(target, snapshot, entities, isCurrent)
      for (const entity of entities) {
        if (!isCurrent(entity) || entity.type !== "group") continue
        const conversation = snapshot.conversations.find((item) => item.id === entity.id)
        if (conversation) {
          const revision = snapshot.versions[entityKey(entity)] ?? 0
          await conversationManager.applyEntity(target, conversation, revision, snapshot.startedAt, () => isCurrent(entity))
        } else {
          const ids = await conversationManager.removeTree(target, entity.id, snapshot.startedAt)
          for (const id of ids) {
            queryClient.removeQueries({ exact: true, queryKey: queryKeys.conversationMessages(target, id) })
            queryClient.removeQueries({ exact: true, queryKey: queryKeys.conversationTopic(target, id) })
            await messageManager.clearConversation(target, id)
          }
        }
        if (!isCurrent(entity)) continue
        void queryClient.invalidateQueries({
          predicate: (query) => query.queryKey.at(-1) === "topic" &&
            JSON.stringify(query.queryKey.slice(0, queryKeys.authenticated(target).length)) === JSON.stringify(queryKeys.authenticated(target)),
        }).catch(options.onError)
      }
      if (entities.some((entity) => entity.type === "user" && entity.id === target.userId && isCurrent(entity))) {
        const profile = snapshot.users.find((user) => user.id === target.userId)
        if (profile && options.isCurrent()) {
          queryClient.setQueryData<ClientUser>(queryKeys.currentUser(target), (current) => current ? {
            ...current, avatar: profile.avatar, email: profile.email, name: profile.name,
            nickname: profile.nickname, phone: profile.phone,
          } : undefined)
        }
        void queryClient.invalidateQueries({ exact: true, queryKey: queryKeys.currentUser(target) }).catch(options.onError)
      }
    },
  })

  return {
    notify(event: string, payload: unknown) {
      if (directorySync.notify(event, payload)) return true
      const change = parseEntityChange(event, payload)
      if (!change) return false
      if (change.entity.type === "user" && change.entity.id !== target.userId) {
        void contactManager.getSnapshot(target).then((snapshot) => {
          if (snapshot.usersById[change.entity.id] || snapshot.directory.userIds.includes(change.entity.id)) sync.notify(event, payload)
        }).catch(options.onError)
      } else sync.notify(event, payload)
      return true
    },
    forget(id: string) {
      sync.forget({ type: "group", id })
      void contactManager.getSnapshot(target).then((snapshot) => {
        if (snapshot.directory.groups.some((group) => group.id === id)) {
          sync.notify("conversation.updated", { conversation_id: id })
        }
      }).catch(options.onError)
    },
    async reconcile() {
      await directorySync.refresh()
      if (!options.isCurrent()) return
      const [contacts, conversations] = await Promise.all([contactManager.getSnapshot(target), conversationManager.list(target)])
      const entities: EntityReference[] = [
        ...[...new Set([target.userId, ...Object.keys(contacts.usersById)])].map((id) => ({ type: "user" as const, id })),
        ...contacts.directory.apps.map(({ id }) => ({ type: "app" as const, id })),
        ...[...new Set([...contacts.directory.groups.filter((group) => group.joined).map((group) => group.id), ...conversations.filter((item) => item.type === "group").map((item) => item.id)])].map((id) => ({ type: "group" as const, id })),
      ]
      await sync.refresh(entities)
    },
    dispose() { directorySync.dispose(); sync.dispose() },
  }
}
