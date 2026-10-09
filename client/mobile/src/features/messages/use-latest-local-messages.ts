import { useEffect, useMemo, useState } from "react"

import type { ClientConversation, ClientMessage } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { messageManager } from "@/data/messages"
import {
  subscribeAllMessageCacheCleared,
  subscribeMessageChanges,
} from "@/data/messages/message-events"

const EMPTY_PREVIEWS = new Map<string, ClientMessage>()

type PreviewSnapshot = {
  scope: string
  messages: ReadonlyMap<string, ClientMessage>
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
  })

  useEffect(() => {
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
          return { scope, messages }
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
          return { scope, messages }
        })
      }).catch(() => undefined)
    })
    const unsubscribeClear = subscribeAllMessageCacheCleared(() => {
      clearGeneration += 1
      changed.clear()
      setSnapshot({ scope, messages: EMPTY_PREVIEWS })
    })

    const generation = clearGeneration
    void messageManager.readLatestLocalPreviews(stableTarget, conversationIds).then((loaded) => {
      if (!active || generation !== clearGeneration) return
      setSnapshot((current) => {
        const messages = new Map(loaded)
        const previous = current.scope === scope ? current.messages : EMPTY_PREVIEWS
        for (const conversationId of changed.keys()) {
          const latest = previous.get(conversationId)
          if (latest) messages.set(conversationId, latest)
          else messages.delete(conversationId)
        }
        return { scope, messages }
      })
    }).catch(() => undefined)

    return () => {
      active = false
      unsubscribe()
      unsubscribeClear()
    }
  }, [stableTarget, scope, conversationIds])

  return snapshot.scope === scope ? snapshot.messages : EMPTY_PREVIEWS
}
