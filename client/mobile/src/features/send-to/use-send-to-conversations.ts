import { useLayoutEffect, useRef, useState } from "react"
import { useRouter } from "expo-router"
import { isUnauthorizedError } from "@/data/api-client"
import { useForwardConversationMessage } from "@/data/messages/message-hooks"
import { sendConversationEntityCardMessage } from "@/data/messages/messages-api"
import { messageManager } from "@/data/messages/message-manager"
import { useAuth, useAuthenticatedSession } from "@/providers/auth-provider"
import { useXGUIToast } from "@/xgui"
import type { SendTargetRequest } from "@/navigation/send-target"

export function useSendToConversations(request: SendTargetRequest, onSent: () => void) {
  const session = useAuthenticatedSession()
  const { invalidateSession } = useAuth()
  const router = useRouter()
  const toast = useXGUIToast()
  const forward = useForwardConversationMessage(session, request.purpose === "forward" ? request.sourceConversationId : "")
  const [submitting, setSubmitting] = useState(false)
  const busy = useRef(false)
  const active = useRef(true)
  const requestIds = useRef(new Map<string, string>())
  useLayoutEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  async function send(ids: string[]) {
    if (!active.current || busy.current || ids.length === 0 || (request.purpose === "namecard" && ids.length !== 1)) return
    busy.current = true
    setSubmitting(true)
    const key = request.purpose === "forward" ? JSON.stringify([...ids].sort()) : ids[0]
    let clientMessageId = requestIds.current.get(key)
    if (!clientMessageId) {
      clientMessageId = createRequestId()
      requestIds.current.set(key, clientMessageId)
    }
    try {
      let message: string
      if (request.purpose === "namecard") {
        const sent = await sendConversationEntityCardMessage(session, ids[0], {
          clientMessageId, entityType: request.entity.type, entityId: request.entity.id,
        })
        await messageManager.writeMessages(session, [sent])
        message = "名片已发送"
      } else {
        const result = await forward.mutateAsync({
          clientForwardId: clientMessageId, messageId: request.messageId, targetConversationIds: ids,
        })
        if (result.sentCount === 0) {
          const failed = result.results.find((item) => item.status === "failed")
          throw new Error(failed?.status === "failed" ? failed.error.message : "转发消息失败，请重试")
        }
        message = result.failedCount > 0
          ? `已转发到 ${result.sentCount} 个会话，${result.failedCount} 个失败`
          : `已转发到 ${result.sentCount} 个会话`
      }
      if (!active.current) return
      toast.show({ message, type: "text", duration: 1_000, modal: false })
      onSent()
    } catch (error) {
      if (!active.current) return
      if (isUnauthorizedError(error)) {
        void invalidateSession()
        router.replace("/server-management")
      } else {
        toast.show({ message: error instanceof Error ? error.message : "发送失败，请重试", type: "error", duration: 2_000 })
      }
    } finally {
      busy.current = false
      if (active.current) setSubmitting(false)
    }
  }
  return { submitting, send }
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16)
    return (char === "x" ? value : (value & 3) | 8).toString(16)
  })
}
