import * as React from "react"

import {
  emptyConversationDraft,
  isConversationDraftEmpty,
  readConversationDrafts,
  writeConversationDrafts,
  type ConversationDraftContent,
  type ConversationDrafts,
} from "@/lib/conversation-drafts"

const conversationDraftPersistDelayMs = 1000

type ConversationDraftUpdater = (
  draft: ConversationDraftContent
) => ConversationDraftContent

export function useConversationDrafts(userId: string) {
  const [drafts, setDrafts] = React.useState<ConversationDrafts>(() =>
    readConversationDrafts(userId)
  )
  const draftsRef = React.useRef(drafts)
  const dirtyRef = React.useRef(false)
  const persistTimerRef = React.useRef<number | null>(null)

  const flushDrafts = React.useCallback(() => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }

    if (!dirtyRef.current) {
      return
    }

    if (writeConversationDrafts(userId, draftsRef.current)) {
      dirtyRef.current = false
    }
  }, [userId])

  const scheduleDraftPersist = React.useCallback(() => {
    dirtyRef.current = true

    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current)
    }

    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null
      flushDrafts()
    }, conversationDraftPersistDelayMs)
  }, [flushDrafts])

  const updateConversationDraft = React.useCallback(
    (conversationId: string, update: ConversationDraftUpdater) => {
      if (!conversationId) {
        return
      }

      const currentDraft =
        draftsRef.current[conversationId] ?? emptyConversationDraft
      const updatedContent = update({
        mentions: currentDraft.mentions,
        replyTarget: currentDraft.replyTarget,
        text: currentDraft.text,
      })
      const nextDrafts = { ...draftsRef.current }

      if (isConversationDraftEmpty(updatedContent)) {
        if (!(conversationId in nextDrafts)) {
          return
        }

        delete nextDrafts[conversationId]
      } else {
        nextDrafts[conversationId] = {
          ...updatedContent,
          updatedAt: Date.now(),
        }
      }

      draftsRef.current = nextDrafts
      setDrafts(nextDrafts)
      scheduleDraftPersist()
    },
    [scheduleDraftPersist]
  )

  const clearConversationDraft = React.useCallback(
    (conversationId: string) => {
      if (!conversationId || !(conversationId in draftsRef.current)) {
        return
      }

      const nextDrafts = { ...draftsRef.current }
      delete nextDrafts[conversationId]
      draftsRef.current = nextDrafts
      setDrafts(nextDrafts)
      scheduleDraftPersist()
    },
    [scheduleDraftPersist]
  )

  React.useEffect(() => {
    function handlePageHide() {
      flushDrafts()
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        flushDrafts()
      }
    }

    window.addEventListener("pagehide", handlePageHide)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.removeEventListener("pagehide", handlePageHide)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      flushDrafts()
    }
  }, [flushDrafts])

  return {
    clearConversationDraft,
    drafts,
    flushDrafts,
    updateConversationDraft,
  }
}
