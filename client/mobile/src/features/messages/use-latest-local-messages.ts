import { useEffect, useMemo, useState } from "react"

import type { ClientConversation, ClientMessage } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { messageManager } from "@/data/messages"
import { traceMobileStartup } from "@/diagnostics/mobile-startup"
import {
  subscribeAllMessageCacheCleared,
  subscribeMessageChanges,
} from "@/data/messages/message-events"

const EMPTY_PREVIEWS = new Map<string, ClientMessage>()

type PreviewSnapshot = {
  scope: string
  messages: ReadonlyMap<string, ClientMessage>
  initialized: boolean
}

export function useLatestLocalMessages(target: AuthenticatedTarget, conversations: ClientConversation[]) {
  const stableTarget = useMemo(
    () => ({ id: target.id, url: target.url, userId: target.userId }),
    [target.id, target.url, target.userId]
  )
  const scope = JSON.stringify([target.id, target.url, target.userId])
  const idsKey = conversations.map((conversation) => conversation.id).sort().join("\u0000")
  const conversationIds = useMemo(() => idsKey ? idsKey.split("\u0000") : [], [idsKey])
  const [snapshot, setSnapshot] = useState<PreviewSnapshot>({
    scope,
    messages: EMPTY_PREVIEWS,
    initialized: false,
  })

  useEffect(() => {
    const startedAt = performance.now()
    traceMobileStartup("previews.load.start", { count: conversationIds.length })
    let active = true
    let clearGeneration = 0
    const changed = new Map<string, number>()
    const included = new Set(conversationIds)
    const unsubscribe = subscribeMessageChanges(stableTarget, (conversationId, event) => {
      if (!included.has(conversationId)) return
      const revision = (changed.get(conversationId) ?? 0) + 1
      changed.set(conversationId, revision)
      if (event.type === "clear") {
        setSnapshot((current) => {
          if (current.scope !== scope || !current.messages.has(conversationId)) return current
          const messages = new Map(current.messages)
          messages.delete(conversationId)
          return { ...current, messages }
        })
        return
      }

      const generation = clearGeneration
      void messageManager.readLatestPage(stableTarget, conversationId, 1).then((page) => {
        if (!active || generation !== clearGeneration || changed.get(conversationId) !== revision) return
        setSnapshot((current) => {
          const messages = new Map(current.scope === scope ? current.messages : EMPTY_PREVIEWS)
          const latest = page.messages[0]
          if (latest) messages.set(conversationId, latest)
          else messages.delete(conversationId)
          return { scope, messages, initialized: current.scope === scope && current.initialized }
        })
      }).catch(() => undefined)
    })
    const unsubscribeClear = subscribeAllMessageCacheCleared(() => {
      clearGeneration += 1
      changed.clear()
      setSnapshot({ scope, messages: EMPTY_PREVIEWS, initialized: true })
    })

    const generation = clearGeneration
    void messageManager.readLatestLocalPreviews(stableTarget, conversationIds).then((loaded) => {
      if (!active || generation !== clearGeneration) {
        traceMobileStartup("previews.load.discarded", { count: conversationIds.length, loaded: loaded.size, elapsedMs: performance.now() - startedAt })
        return
      }
      traceMobileStartup("previews.load.ready", { count: conversationIds.length, loaded: loaded.size, elapsedMs: performance.now() - startedAt })
      setSnapshot((current) => {
        const messages = new Map(loaded)
        const previous = current.scope === scope ? current.messages : EMPTY_PREVIEWS
        for (const conversationId of changed.keys()) {
          const latest = previous.get(conversationId)
          if (latest) messages.set(conversationId, latest)
          else messages.delete(conversationId)
        }
        return { scope, messages, initialized: conversationIds.length > 0 || (current.scope === scope && current.initialized) }
      })
    }).catch(() => {
      traceMobileStartup("previews.load.failed", { count: conversationIds.length, elapsedMs: performance.now() - startedAt, failures: 1 })
      if (!active || generation !== clearGeneration) return
      setSnapshot((current) => ({
        scope,
        messages: current.scope === scope ? current.messages : EMPTY_PREVIEWS,
        initialized: conversationIds.length > 0 || (current.scope === scope && current.initialized),
      }))
    })

    return () => {
      active = false
      unsubscribe()
      unsubscribeClear()
    }
  }, [stableTarget, scope, conversationIds])

  return {
    latestMessages: snapshot.scope === scope ? snapshot.messages : EMPTY_PREVIEWS,
    isLoading: conversationIds.length > 0 && (snapshot.scope !== scope || !snapshot.initialized),
  }
}
