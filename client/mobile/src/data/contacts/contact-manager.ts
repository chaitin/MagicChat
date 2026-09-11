import type { ClientContactDirectory, ContactGroup, ContactUser } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { fetchContacts } from "@/data/contacts/contacts-api"
import { mergeUserProfiles, readContactDirectory, readUserProfiles, replaceContactDirectory } from "@/data/contacts/contact-cache-store"
import { createServerKey } from "@/data/server-key"
import { resolveClientUsers } from "@/data/users/user-profiles-api"

const PROFILE_TTL = 5 * 60_000
const MISSING_TTL = 30_000
const BATCH_SIZE = 100
const EMPTY_DIRECTORY: ClientContactDirectory = { apps: [], groups: [], userIds: [] }

export type ContactSnapshot = {
  directory: ClientContactDirectory
  unavailableUserIds: ReadonlySet<string>
  usersById: Readonly<Record<string, ContactUser>>
}

class ContactManager {
  private snapshots = new Map<string, ContactSnapshot>()
  private loaded = new Map<string, Promise<ContactSnapshot>>()
  private listeners = new Map<string, Set<(snapshot: ContactSnapshot) => void>>()
  private refreshes = new Map<string, Promise<ContactSnapshot>>()
  private userTasks = new Map<string, Promise<void>>()
  private mutationRevisions = new Map<string, number>()
  private writeQueues = new Map<string, Promise<void>>()

  async getSnapshot(target: AuthenticatedTarget) {
    const key = targetKey(target)
    const existing = this.snapshots.get(key)
    if (existing) return existing
    let task = this.loaded.get(key)
    if (!task) {
      task = this.load(target).catch((error) => {
        this.loaded.delete(key)
        throw error
      })
      this.loaded.set(key, task)
    }
    return task
  }

  async refresh(target: AuthenticatedTarget) {
    const key = targetKey(target)
    let task = this.refreshes.get(key)
    if (!task) {
      task = (async () => {
        await this.getSnapshot(target)
        const revision = this.mutationRevisions.get(key) ?? 0
        const directory = await fetchContacts(target)
        return this.enqueueWrite(key, async () => {
          if ((this.mutationRevisions.get(key) ?? 0) !== revision) {
            return this.getSnapshot(target)
          }
          await replaceContactDirectory(target, directory)
          const current = await this.getSnapshot(target)
          return this.commit(target, { ...current, directory })
        })
      })().finally(() => this.refreshes.delete(key))
      this.refreshes.set(key, task)
    }
    return task
  }

  async ensureUsers(target: AuthenticatedTarget, rawIds: string[]) {
    return this.queueUsers(target, rawIds, false)
  }

  async refreshUsers(target: AuthenticatedTarget, rawIds: string[]) {
    return this.queueUsers(target, rawIds, true)
  }

  private queueUsers(target: AuthenticatedTarget, rawIds: string[], force: boolean) {
    const key = targetKey(target)
    const previous = this.userTasks.get(key)
    const task = (async () => {
      await previous?.catch(() => undefined)
      await this.ensureUsersSerial(target, rawIds, force)
    })()
    this.userTasks.set(key, task)
    return task.finally(() => {
      if (this.userTasks.get(key) === task) this.userTasks.delete(key)
    })
  }

  private async ensureUsersSerial(target: AuthenticatedTarget, rawIds: string[], force: boolean) {
    const snapshot = await this.getSnapshot(target)
    const rows = await readUserProfiles(target)
    const now = Date.now()
    const normalizedIds = [...new Set(rawIds.map((id) => id.trim()).filter(Boolean))]
    const ids = force ? normalizedIds : normalizedIds.filter((id) => {
      const row = rows.get(id)
      return !(row && (row.missing_until ?? 0) > now) && !(row?.profile && now - row.cached_at < PROFILE_TTL)
    })
    for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
      const batch = ids.slice(offset, offset + BATCH_SIZE)
      const profiles = await resolveClientUsers(target, batch)
      const returned = new Set(profiles.map((profile) => profile.id))
      await mergeUserProfiles(target, profiles, batch.filter((id) => !returned.has(id)), Date.now() + MISSING_TTL)
      const latest = await readUserProfiles(target)
      const currentSnapshot = this.snapshots.get(targetKey(target)) ?? snapshot
      const usersById: Record<string, ContactUser> = {}
      const unavailable = new Set<string>()
      for (const [id, row] of latest) {
        if (row.profile) usersById[id] = row.profile
        else if ((row.missing_until ?? 0) > Date.now()) unavailable.add(id)
      }
      this.commit(target, { directory: currentSnapshot.directory, unavailableUserIds: unavailable, usersById })
    }
  }

  async upsertGroup(target: AuthenticatedTarget, group: ContactGroup) {
    return this.changeGroups(target, (groups) => [...groups.filter((item) => item.id !== group.id), group])
  }
  async patchGroup(target: AuthenticatedTarget, id: string, patch: Partial<ContactGroup>) {
    return this.changeGroups(target, (groups) => groups.map((group) => group.id === id ? { ...group, ...patch, id, type: "group" } : group))
  }
  async removeGroup(target: AuthenticatedTarget, id: string) {
    return this.changeGroups(target, (groups) => groups.filter((group) => group.id !== id))
  }
  subscribe(target: AuthenticatedTarget, listener: (snapshot: ContactSnapshot) => void) {
    const key = targetKey(target)
    const listeners = this.listeners.get(key) ?? new Set()
    listeners.add(listener); this.listeners.set(key, listeners)
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key) }
  }
  private async changeGroups(target: AuthenticatedTarget, update: (groups: ContactGroup[]) => ContactGroup[]) {
    const key = targetKey(target)
    this.mutationRevisions.set(key, (this.mutationRevisions.get(key) ?? 0) + 1)
    return this.enqueueWrite(key, async () => {
      const current = await this.getSnapshot(target)
      const directory = {
        ...current.directory,
        groups: update(current.directory.groups),
      }
      await replaceContactDirectory(target, directory)
      const latest = await this.getSnapshot(target)
      return this.commit(target, { ...latest, directory })
    })
  }
  private enqueueWrite<T>(key: string, operation: () => Promise<T>) {
    const previous = this.writeQueues.get(key)
    const result = (async () => {
      await previous?.catch(() => undefined)
      return operation()
    })()
    const tail = result.then(() => undefined, () => undefined)
    this.writeQueues.set(key, tail)
    return result.finally(() => {
      if (this.writeQueues.get(key) === tail) this.writeQueues.delete(key)
    })
  }
  private async load(target: AuthenticatedTarget) {
    const [directory, rows] = await Promise.all([readContactDirectory(target), readUserProfiles(target)])
    const usersById: Record<string, ContactUser> = {}; const unavailable = new Set<string>()
    for (const [id, row] of rows) {
      if (row.profile) usersById[id] = row.profile
      else if ((row.missing_until ?? 0) > Date.now()) unavailable.add(id)
    }
    return this.commit(target, { directory: directory ?? EMPTY_DIRECTORY, unavailableUserIds: unavailable, usersById }, false)
  }
  private commit(target: AuthenticatedTarget, snapshot: ContactSnapshot, notify = true) {
    const key = targetKey(target); const previous = this.snapshots.get(key)
    if (previous && serialize(previous) === serialize(snapshot)) return previous
    this.snapshots.set(key, snapshot)
    if (notify) for (const listener of this.listeners.get(key) ?? []) listener(snapshot)
    return snapshot
  }
}

function targetKey(target: AuthenticatedTarget) { return `${createServerKey(target)}\0${target.userId}` }
function serialize(value: ContactSnapshot) { return JSON.stringify([value.directory, value.usersById, [...value.unavailableUserIds].sort()]) }
export const contactManager = new ContactManager()
