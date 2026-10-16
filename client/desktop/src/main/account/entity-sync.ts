import { DirectorySynchronizer } from "../../../../shared/directory-sync.ts"
import { EntitySynchronizer, entityKey, parseEntityChange, type EntityReference } from "../../../../shared/entity-sync.ts"
import type { AccountDatabase } from "./account-database"
import type { AvatarManager } from "./avatar-manager"
import type { AvatarDescriptor } from "./avatar-types"
import type { ContactManager } from "./contact-manager"
import type { ConversationManager } from "./conversation-manager"

export function createDesktopEntitySync(options: {
  database: AccountDatabase
  contacts: ContactManager
  conversations: ConversationManager
  avatars: AvatarManager
  currentUser: AvatarDescriptor
  isCurrent: () => boolean
  onChanged: (conversationIds: string[], avatars: EntityReference[]) => void
  onError: (error: unknown) => void
}) {
  const { database, contacts, conversations, avatars } = options
  const directorySync = new DirectorySynchronizer({
    isCurrent: options.isCurrent,
    onError: options.onError,
    refresh: async () => {
      await contacts.refresh()
      if (options.isCurrent()) options.onChanged([], [])
    },
  })
  const sync = new EntitySynchronizer({
    isCurrent: options.isCurrent,
    onError: options.onError,
    resolve: (entities) => contacts.resolveEntities(entities),
    version: (snapshot, entity) => snapshot.versions[entityKey(entity)] ?? null,
    apply: async (snapshot, references, isCurrent) => {
      const entities = references.filter(isCurrent)
      if (!entities.length) return
      const groups = new Set<string>()
      for (const entity of entities) {
        if (entity.type === "group") groups.add(entity.id)
        else for (const id of contacts.groupsUsingAvatar(entity.type, entity.id)) groups.add(id)
      }
      contacts.applyEntities(snapshot, entities)
      for (const entity of entities) {
        if (entity.type === "group") {
          const value = snapshot.conversations.find((item) => item.id === entity.id)
          if (value) conversations.applyEntity(value, snapshot.versions[entityKey(entity)] ?? 0)
          else conversations.removeEntity(entity.id)
        } else if (entity.type === "user" && entity.id === options.currentUser.id) {
          const descriptor = contacts.getAvatarDescriptor("user", entity.id)
          if (descriptor) Object.assign(options.currentUser, descriptor)
        }
        avatars.markChanged(entity.type, entity.id)
      }
      for (const id of groups) avatars.markChanged("group", id)
      const ids = [...new Set([...groups].flatMap((id) => database.relatedConversationIds(id)))]
      options.onChanged(ids, entities)
    },
  })

  return {
    notify(event: string, payload: unknown) {
      if (directorySync.notify(event, payload)) return true
      const change = parseEntityChange(event, payload)
      if (!change) return false
      if (change.entity.type !== "user" || change.entity.id === options.currentUser.id || database.getContactPayload("user", change.entity.id)) {
        sync.notify(event, payload)
      }
      return true
    },
    forget(id: string) {
      sync.forget({ type: "group", id })
      if (database.getContactPayload("group", id)) sync.notify("conversation.updated", { conversation_id: id })
    },
    async reconcile() {
      await directorySync.refresh()
      if (!options.isCurrent()) return
      const directory = contacts.getDirectory()
      await sync.refresh([
        ...[...new Set([options.currentUser.id, ...directory.users.map((user) => user.id)])].map((id) => ({ type: "user" as const, id })),
        ...directory.apps.map(({ id }) => ({ type: "app" as const, id })),
        ...[...new Set([...directory.groups.filter((group) => group.joined).map((group) => group.id), ...database.listConversations().filter((item) => item.type === "group").map((item) => item.id)])].map((id) => ({ type: "group" as const, id })),
      ])
    },
    dispose() { directorySync.dispose(); sync.dispose() },
  }
}
