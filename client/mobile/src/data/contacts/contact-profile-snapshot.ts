import type { ContactUser } from "@/core/models"
import type { ContactSnapshot } from "@/data/contacts/contact-manager"

type ProfileUpdate = { profile: ContactUser | null; missing_until: number | null }

export function applyContactProfileBatch(
  snapshot: ContactSnapshot,
  batch: readonly string[],
  latest: ReadonlyMap<string, ProfileUpdate>,
  now: number
): ContactSnapshot {
  const usersById: Record<string, ContactUser> = { ...snapshot.usersById }
  const unavailable = new Set(snapshot.unavailableUserIds)
  for (const id of batch) {
    const row = latest.get(id)
    if (row?.profile) {
      usersById[id] = row.profile
      unavailable.delete(id)
    } else {
      delete usersById[id]
      if (row && (row.missing_until ?? 0) > now) unavailable.add(id)
      else unavailable.delete(id)
    }
  }
  return { directory: snapshot.directory, unavailableUserIds: unavailable, usersById }
}
