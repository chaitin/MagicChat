import { useCallback, useEffect, useMemo, useState } from "react"
import type { CachedMedia, MediaCacheRequest, MediaCacheStatus } from "../../../shared/media"

type CachedMediaState = {
  cached?: CachedMedia
  downloadedBytes: number
  error?: string
  status: "idle" | MediaCacheStatus
  totalBytes?: number
}

export function useCachedMedia(input: MediaCacheRequest, automatic: boolean) {
  const request = useMemo<MediaCacheRequest>(
    () => ({ ...input }),
    [
      input.targetId,
      input.fileId,
      input.category,
      input.originalName,
      input.contentType,
      input.expectedSizeBytes,
    ],
  )
  const outgoingId = request.fileId.startsWith("outgoing:")
    ? request.fileId.slice("outgoing:".length)
    : ""
  const outgoing = useMemo<CachedMedia | undefined>(
    () =>
      outgoingId
        ? {
            cacheKey: request.fileId,
            category: request.category,
            contentType: request.contentType || "application/octet-stream",
            originalName:
              request.originalName || (request.category === "image" ? "image" : "video"),
            resourceUrl: `jiying-media://outgoing/${encodeURIComponent(request.targetId)}/${encodeURIComponent(outgoingId)}`,
            sizeBytes: request.expectedSizeBytes ?? 0,
          }
        : undefined,
    [outgoingId, request],
  )
  const [state, setState] = useState<CachedMediaState>({
    status: "idle",
    downloadedBytes: 0,
  })

  const ensureCached = useCallback(async () => {
    if (outgoing) return outgoing
    const media = window.desktop?.media
    if (!media) return undefined
    setState((current) => ({ ...current, status: "downloading", error: undefined }))
    const result = await media.ensureCached(request)
    if (!result.ok) {
      setState((current) => ({ ...current, status: "failed", error: result.error.message }))
      return undefined
    }
    setState({
      cached: result.data,
      downloadedBytes: result.data.sizeBytes,
      status: "ready",
      totalBytes: result.data.sizeBytes,
    })
    return result.data
  }, [outgoing, request])

  useEffect(() => {
    if (automatic || outgoing) return
    const media = window.desktop?.media
    if (!media) return
    let cancelled = false
    void media.checkCached(request).then((result) => {
      if (cancelled || !result.ok || !result.data) return
      setState({
        cached: result.data,
        downloadedBytes: result.data.sizeBytes,
        status: "ready",
        totalBytes: result.data.sizeBytes,
      })
    })
    return () => {
      cancelled = true
    }
  }, [automatic, outgoing, request])

  useEffect(() => {
    const media = window.desktop?.media
    if (!media) return
    return media.onDownloadProgress((event) => {
      if (
        event.targetId !== request.targetId ||
        event.fileId !== request.fileId ||
        event.category !== request.category
      ) {
        return
      }
      setState((current) => ({
        ...current,
        status: event.status,
        downloadedBytes: event.downloadedBytes,
        totalBytes: event.totalBytes,
        error: event.status === "failed" ? event.message : undefined,
      }))
    })
  }, [request])

  useEffect(() => {
    if (!automatic || outgoing) return
    void ensureCached()
  }, [automatic, ensureCached, outgoing])

  return outgoing
    ? {
        cached: outgoing,
        downloadedBytes: outgoing.sizeBytes,
        status: "ready" as const,
        totalBytes: outgoing.sizeBytes,
        ensureCached,
      }
    : { ...state, ensureCached }
}
