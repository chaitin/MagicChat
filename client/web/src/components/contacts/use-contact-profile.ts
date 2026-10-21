import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { resolveClientEntities } from "@/lib/client-api/entity-sync"
import {
  resolveActiveDirectoryItem,
  type ActiveDirectoryItem,
  type DirectorySelection,
} from "./contact-directory"
import {
  selectEntityProfile,
  type EntityProfileResult,
} from "../../../../shared/entity-profile-result"

export function useContactProfile({
  selection,
  cached,
  accountId,
}: {
  selection: DirectorySelection | null
  cached: ActiveDirectoryItem | null
  accountId: string
}) {
  const cachedRevision = cached
    ? ((cached.type === "app"
        ? cached.app.entityRevision
        : cached.type === "group"
          ? cached.group.entityRevision
          : cached.contact.entityRevision) ?? 0)
    : null
  const cachedRevisionRef = useRef(cachedRevision)
  useLayoutEffect(() => {
    cachedRevisionRef.current = cachedRevision
  }, [cachedRevision])
  const lookupKey = JSON.stringify([accountId, selection])
  const [lookup, setLookup] = useState<{
    key: string
    result: EntityProfileResult<ActiveDirectoryItem>
  } | null>(null)
  useEffect(() => {
    if (!selection || selection.type === "user") return
    let active = true
    const revisionAtStart = cachedRevisionRef.current
    void resolveClientEntities([selection])
      .then((snapshot) => {
        if (!active) return
        const profile = resolveActiveDirectoryItem(
          selection,
          snapshot.apps,
          [],
          snapshot.groups
        )
        const revision =
          snapshot.versions[`${selection.type}:${selection.id}`] ??
          revisionAtStart ??
          0
        // Detail-only reads must never mutate shared contacts, conversations or permissions.
        setLookup({
          key: lookupKey,
          result: { profile, revision, cachedRevision: revisionAtStart },
        })
        if (
          !profile &&
          cachedRevisionRef.current === revisionAtStart &&
          revision >= (revisionAtStart ?? 0)
        ) {
          toast.error("资料不存在或无权查看")
        }
      })
      .catch(() => {
        if (active) toast.error("无法加载资料，请重试")
      })
    return () => {
      active = false
    }
  }, [selection, lookupKey])

  return selectEntityProfile(
    cached,
    cachedRevision,
    lookup?.key === lookupKey ? lookup.result : null
  )
}
