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
  const [state, setState] = useState<CachedMediaState>({
    status: "idle",
    downloadedBytes: 0,
  })

  const ensureCached = useCallback(async () => {
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
  }, [request])

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
    if (!automatic) return
    void ensureCached()
  }, [automatic, ensureCached])

  return { ...state, ensureCached }
}
