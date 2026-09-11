import * as React from "react"
import type { EditorEvents } from "@tiptap/core"
import type { Editor } from "@tiptap/react"

import {
  collectDocumentImageFileIds,
  transactionChangesDocumentImages,
} from "@/components/documents/document-image-extension"
import type { DocumentImageResolution } from "@/components/documents/document-image-resolution"
import { resolveDocumentImageURLs } from "@/lib/document-image-api"

const refreshSafetyWindowMs = 5 * 60 * 1000
const maximumRetryCount = 3

type RefreshRequest = (
  fileIds: string[],
  options?: { forceRefresh?: boolean; resetRetryCount?: boolean }
) => void

export function useDocumentImageResolutions(editor: Editor | null) {
  const [resolutions, setResolutions] = React.useState<
    Map<string, DocumentImageResolution>
  >(() => new Map())
  const requestRef = React.useRef<RefreshRequest>(() => undefined)

  React.useEffect(() => {
    if (!editor) return
    const activeEditor = editor
    const activeFileIds = new Set<string>()
    const forcePending = new Set<string>()
    const pendingFileIds = new Set<string>()
    const resolutionsByFileId = new Map<string, DocumentImageResolution>()
    const retryCounts = new Map<string, number>()
    const retryTimers = new Set<ReturnType<typeof setTimeout>>()
    const suppressedAutomaticRefresh = new Set<string>()
    let active = true
    let fileIdSignature: string | null = null
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let running = false

    function publishResolutions() {
      setResolutions(new Map(resolutionsByFileId))
    }

    function scheduleAutomaticRefresh() {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = undefined
      let earliestRefreshAt = Number.POSITIVE_INFINITY
      for (const [fileId, resolution] of resolutionsByFileId) {
        if (
          resolution.status !== "ready" ||
          suppressedAutomaticRefresh.has(fileId)
        ) {
          continue
        }
        const expiresAt = Date.parse(resolution.expiresAt)
        if (Number.isFinite(expiresAt)) {
          earliestRefreshAt = Math.min(
            earliestRefreshAt,
            expiresAt - refreshSafetyWindowMs
          )
        }
      }
      if (!Number.isFinite(earliestRefreshAt)) return
      refreshTimer = setTimeout(
        () => {
          const threshold = Date.now() + refreshSafetyWindowMs + 1_000
          const dueFileIds = Array.from(resolutionsByFileId)
            .filter(([fileId, resolution]) => {
              if (
                resolution.status !== "ready" ||
                suppressedAutomaticRefresh.has(fileId)
              ) {
                return false
              }
              const expiresAt = Date.parse(resolution.expiresAt)
              return Number.isFinite(expiresAt) && expiresAt <= threshold
            })
            .map(([fileId]) => fileId)
          requestRefresh(dueFileIds, { forceRefresh: true })
        },
        Math.max(earliestRefreshAt - Date.now(), 1_000)
      )
    }

    function synchronizeImageSet() {
      const nextFileIds = collectDocumentImageFileIds(activeEditor.state.doc)
      const nextSignature = [...nextFileIds].sort().join("\u0000")
      if (nextSignature === fileIdSignature) return
      fileIdSignature = nextSignature

      const nextFileIdSet = new Set(nextFileIds)
      const addedFileIds = nextFileIds.filter(
        (fileId) => !activeFileIds.has(fileId)
      )
      for (const fileId of activeFileIds) {
        if (nextFileIdSet.has(fileId)) continue
        activeFileIds.delete(fileId)
        forcePending.delete(fileId)
        pendingFileIds.delete(fileId)
        resolutionsByFileId.delete(fileId)
        retryCounts.delete(fileId)
        suppressedAutomaticRefresh.delete(fileId)
      }
      for (const fileId of nextFileIds) {
        activeFileIds.add(fileId)
        resolutionsByFileId.set(
          fileId,
          resolutionsByFileId.get(fileId) ?? { status: "loading" }
        )
      }
      publishResolutions()
      scheduleAutomaticRefresh()
      requestRefresh(addedFileIds)
    }

    async function runQueue() {
      if (running || !active) return
      running = true
      while (pendingFileIds.size > 0 && active) {
        const targetFileIds = Array.from(pendingFileIds).filter((fileId) =>
          activeFileIds.has(fileId)
        )
        pendingFileIds.clear()
        if (targetFileIds.length === 0) continue
        const forceRefresh = targetFileIds.some((fileId) =>
          forcePending.has(fileId)
        )
        for (const fileId of targetFileIds) forcePending.delete(fileId)

        try {
          const result = await resolveDocumentImageURLs(
            targetFileIds,
            forceRefresh
          )
          if (!active) return
          const urlsByFileId = new Map(
            result.urls.map((value) => [value.fileId, value])
          )
          const missingFileIds = new Set(result.missingFileIds)
          for (const fileId of targetFileIds) {
            if (!activeFileIds.has(fileId)) continue
            const value = urlsByFileId.get(fileId)
            if (value) {
              resolutionsByFileId.set(fileId, {
                expiresAt: value.expiresAt,
                status: "ready",
                url: value.url,
              })
            } else {
              resolutionsByFileId.set(fileId, {
                status: missingFileIds.has(fileId) ? "failed" : "loading",
              })
            }
            retryCounts.delete(fileId)
            suppressedAutomaticRefresh.delete(fileId)
          }
          publishResolutions()
          scheduleAutomaticRefresh()
        } catch {
          if (!active) return
          const retryableFileIds: string[] = []
          let retryDelay = 1_000
          for (const fileId of targetFileIds) {
            if (!activeFileIds.has(fileId)) continue
            const retryCount = (retryCounts.get(fileId) ?? 0) + 1
            retryCounts.set(fileId, retryCount)
            if (retryCount <= maximumRetryCount) {
              retryableFileIds.push(fileId)
              retryDelay = Math.max(retryDelay, 2 ** (retryCount - 1) * 1_000)
            } else {
              suppressedAutomaticRefresh.add(fileId)
              if (resolutionsByFileId.get(fileId)?.status !== "ready") {
                resolutionsByFileId.set(fileId, { status: "failed" })
              }
            }
          }
          publishResolutions()
          scheduleAutomaticRefresh()
          if (retryableFileIds.length > 0) {
            const timer = setTimeout(() => {
              retryTimers.delete(timer)
              requestRefresh(retryableFileIds, { forceRefresh: true })
            }, retryDelay)
            retryTimers.add(timer)
          }
        }
      }
      running = false
    }

    function requestRefresh(
      fileIds: string[],
      options: { forceRefresh?: boolean; resetRetryCount?: boolean } = {}
    ) {
      for (const fileId of fileIds) {
        if (!activeFileIds.has(fileId)) continue
        pendingFileIds.add(fileId)
        if (options.forceRefresh) forcePending.add(fileId)
        if (options.resetRetryCount) {
          retryCounts.delete(fileId)
          suppressedAutomaticRefresh.delete(fileId)
        }
      }
      void runQueue()
    }

    requestRef.current = requestRefresh
    const handleTransaction = ({
      transaction,
    }: EditorEvents["transaction"]) => {
      if (transactionChangesDocumentImages(transaction)) synchronizeImageSet()
    }
    activeEditor.on("transaction", handleTransaction)
    synchronizeImageSet()

    return () => {
      active = false
      if (refreshTimer) clearTimeout(refreshTimer)
      for (const timer of retryTimers) clearTimeout(timer)
      requestRef.current = () => undefined
      activeEditor.off("transaction", handleTransaction)
    }
  }, [editor])

  const refresh = React.useCallback((fileId: string) => {
    if (!fileId) return
    requestRef.current([fileId], {
      forceRefresh: true,
      resetRetryCount: true,
    })
  }, [])

  return { refresh, resolutions }
}
