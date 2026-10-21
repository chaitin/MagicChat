import { useFocusEffect } from "expo-router"
import { useCallback, useLayoutEffect, useRef, useState } from "react"
import type { AuthenticatedTarget } from "@/core/server-target"
import { resolveClientEntities } from "@/data/contacts/entity-sync-api"
import {
  resolveEntityProfile,
  type EntityProfile,
  type EntityReference,
} from "@/domain/entities/entity-profile"
import {
  selectEntityProfile,
  type EntityProfileResult,
} from "../../../../shared/entity-profile-result"

type Lookup = {
  key: string
  attempt: number
  loading: boolean
  result: EntityProfileResult<EntityProfile> | null
  error: Error | null
}

export function useEntityProfileLookup({
  target,
  reference,
  cached,
  revision,
}: {
  target: AuthenticatedTarget
  reference: EntityReference | null
  cached: EntityProfile | null
  revision: number
}) {
  const cachedRevision = cached ? revision : null
  const cachedRevisionRef = useRef(cachedRevision)
  useLayoutEffect(() => {
    cachedRevisionRef.current = cachedRevision
  }, [cachedRevision])
  const [attempt, setAttempt] = useState(0)
  const [lookup, setLookup] = useState<Lookup | null>(null)
  const key = JSON.stringify([target.id, target.url, target.userId, reference])
  useFocusEffect(
    useCallback(() => {
      if (!reference) return
      let active = true
      const revisionAtStart = cachedRevisionRef.current
      setLookup((current) => ({
        key,
        attempt,
        loading: true,
        error: null,
        result: current?.key === key ? current.result : null,
      }))
      void resolveClientEntities(target, [reference])
        .then((snapshot) => {
          if (!active) return
          const profile = resolveEntityProfile({
            contacts: { apps: snapshot.apps, groups: snapshot.groups, users: snapshot.users },
            conversations: [],
            currentUser: null,
            reference,
          })
          if (
            !profile &&
            !snapshot.removed.some(
              (entity) => entity.type === reference.type && entity.id === reference.id,
            )
          ) {
            throw new Error("资料响应不完整，请重试")
          }
          const result = {
            profile,
            cachedRevision: revisionAtStart,
            revision:
              snapshot.versions[`${reference.type}:${reference.id}`] ?? revisionAtStart ?? 0,
          }
          setLookup({ key, attempt, loading: false, error: null, result })
        })
        .catch((error: unknown) => {
          if (active)
            setLookup((current) => ({
              key,
              attempt,
              loading: false,
              result: current?.key === key ? current.result : null,
              error: error instanceof Error ? error : new Error("资料加载失败，请重试"),
            }))
        })
      return () => {
        active = false
      }
    }, [attempt, key, reference, target]),
  )

  const current = lookup?.key === key ? lookup : null
  const profile = selectEntityProfile(cached, cachedRevision, current?.result ?? null)
  return {
    profile,
    loading: Boolean(reference) && (!current || current.attempt !== attempt || current.loading),
    error: current?.error ?? null,
    unavailable: Boolean(current?.result && !profile && !current.result.profile),
    retry: useCallback(() => setAttempt((value) => value + 1), []),
  }
}
