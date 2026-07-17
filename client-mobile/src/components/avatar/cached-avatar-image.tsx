import { useCallback, useEffect, useRef, useState } from "react"
import { Avatar, Image } from "tamagui"

import type { ServerTarget } from "@/data/query"
import { useCachedAvatar } from "@/data/resources"

export function CachedAvatarImage({
  avatar,
  server,
}: {
  avatar: string
  server: ServerTarget
}) {
  const { refetch, sourceUrl, uri } = useCachedAvatar(server, avatar)

  return uri ? (
    <RetryableAvatarImage
      key={sourceUrl}
      refetch={refetch}
      uri={uri}
    />
  ) : null
}

export function CachedAvatarTileImage({
  avatar,
  server,
}: {
  avatar: string
  server: ServerTarget
}) {
  const { refetch, sourceUrl, uri } = useCachedAvatar(server, avatar)

  return uri ? (
    <RetryableTileImage key={sourceUrl} refetch={refetch} uri={uri} />
  ) : null
}

function RetryableAvatarImage({
  refetch,
  uri,
}: {
  refetch: () => Promise<unknown>
  uri: string
}) {
  const { failed, handleError, revision } = useRetryableImage(refetch)

  return failed ? null : (
    <Avatar.Image
      key={revision}
      onError={() => void handleError()}
      src={uri}
    />
  )
}

function RetryableTileImage({
  refetch,
  uri,
}: {
  refetch: () => Promise<unknown>
  uri: string
}) {
  const { failed, handleError, revision } = useRetryableImage(refetch)

  return failed ? null : (
    <Image
      height="100%"
      key={revision}
      objectFit="cover"
      onError={() => void handleError()}
      src={uri}
      width="100%"
    />
  )
}

function useRetryableImage(refetch: () => Promise<unknown>) {
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const mountedRef = useRef(true)
  const retryCountRef = useRef(0)
  const retryingRef = useRef(false)

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleError = useCallback(async () => {
    if (retryingRef.current || failed) return

    if (retryCountRef.current >= 1) {
      setFailed(true)
      return
    }

    retryCountRef.current += 1
    retryingRef.current = true

    try {
      await refetch()
      if (mountedRef.current) {
        setRevision((current) => current + 1)
      }
    } catch {
      if (mountedRef.current) {
        setFailed(true)
      }
    } finally {
      retryingRef.current = false
    }
  }, [failed, refetch])

  return { failed, handleError, revision }
}
