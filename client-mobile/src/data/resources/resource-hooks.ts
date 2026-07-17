import { useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState } from "react"

import { queryKeys, type AuthenticatedTarget, type ServerTarget } from "@/data/query"
import {
  ensureAttachmentResource,
  ensureAvatarResource,
  getCachedAttachmentResource,
  invalidateAttachmentResource,
  invalidateAvatarResource,
  resolveAvatarResourceUrl,
} from "@/data/resources/resource-repository"
import type {
  AttachmentResourceReference,
  ResourceLoadState,
  ResolvedResource,
} from "@/data/resources/resource-types"

export function useCachedAvatar(server: ServerTarget, avatar: string) {
  const sourceUrl = resolveAvatarResourceUrl(server, avatar)
  const query = useQuery({
    enabled: sourceUrl.length > 0,
    queryFn: ({ signal }) =>
      ensureAvatarResource(server, { type: "avatar", url: sourceUrl }, { signal }),
    queryKey: queryKeys.avatarResource(server, sourceUrl),
    staleTime: Infinity,
  })
  const refetch = useCallback(async () => {
    await invalidateAvatarResource(server, sourceUrl)
    return query.refetch()
  }, [query, server, sourceUrl])

  return {
    error: query.error,
    isLoading: query.isLoading,
    refetch,
    sourceUrl,
    uri: query.data?.uri ?? "",
  }
}

export function useMessageResources(
  session: AuthenticatedTarget,
  references: AttachmentResourceReference[]
) {
  const referencesById = useMemo(
    () => new Map(references.map((reference) => [reference.fileId, reference])),
    [references]
  )
  const [states, setStates] = useState<ReadonlyMap<string, ResourceLoadState>>(
    () => new Map()
  )

  const ensure = useCallback(
    async (fileId: string): Promise<ResolvedResource> => {
      const reference = referencesById.get(fileId)
      if (!reference) throw new Error("消息资源不存在")

      setResourceState(setStates, fileId, {
        error: null,
        resource: null,
        status: "loading",
      })

      try {
        const resource = await ensureAttachmentResource(session, reference)
        setResourceState(setStates, fileId, {
          error: null,
          resource,
          status: "ready",
        })
        return resource
      } catch (error: unknown) {
        const normalizedError =
          error instanceof Error ? error : new Error("资源下载失败")
        setResourceState(setStates, fileId, {
          error: normalizedError,
          resource: null,
          status: "error",
        })
        throw normalizedError
      }
    },
    [referencesById, session]
  )
  const reload = useCallback(
    async (fileId: string) => {
      const reference = referencesById.get(fileId)
      if (!reference) throw new Error("消息资源不存在")
      await invalidateAttachmentResource(session, reference)
      return ensure(fileId)
    },
    [ensure, referencesById, session]
  )

  useEffect(() => {
    let cancelled = false
    const activeIds = new Set(references.map((reference) => reference.fileId))

    async function hydrateCachedResources() {
      const results = await Promise.all(
        references.map(async (reference) => ({
          cached: await getCachedAttachmentResource(session, reference),
          reference,
        }))
      )
      if (cancelled) return

      setStates((current) => {
        const next = new Map(
          Array.from(current).filter(([fileId]) => activeIds.has(fileId))
        )

        for (const { cached, reference } of results) {
          if (cached) {
            next.set(reference.fileId, {
              error: null,
              resource: cached,
              status: "ready",
            })
          } else if (!next.has(reference.fileId)) {
            next.set(reference.fileId, {
              error: null,
              resource: null,
              status: reference.kind === "image" ? "loading" : "idle",
            })
          }
        }

        return next
      })

      for (const { cached, reference } of results) {
        if (!cached && reference.kind === "image") {
          void ensure(reference.fileId).catch(() => undefined)
        }
      }
    }

    void hydrateCachedResources()
    return () => {
      cancelled = true
    }
  }, [ensure, references, session])

  return { ensure, reload, states }
}

function setResourceState(
  setStates: React.Dispatch<
    React.SetStateAction<ReadonlyMap<string, ResourceLoadState>>
  >,
  fileId: string,
  state: ResourceLoadState
) {
  setStates((current) => {
    const next = new Map(current)
    next.set(fileId, state)
    return next
  })
}
