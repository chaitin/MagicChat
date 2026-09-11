import * as Clipboard from "expo-clipboard"
import { useRouter } from "expo-router"
import { useCallback, useEffect } from "react"

import { ApiRequestError, isUnauthorizedError } from "@/data/api-client"
import { useRevokeConversationMessage } from "@/data/messages/message-hooks"
import type { AuthenticatedTarget } from "@/core/server-target"
import {
  formatClientMessageBodySummary,
  type MessageMentionLabelResolver,
  type PresentedMessage,
} from "@/domain/messages/message-presenter"
import type { MessageReplyTarget } from "@/features/conversation/composer/message-reply-preview"
import { addMessageSelectionActionListener } from "@/native/message-selection-actions"
import { useAuth } from "@/providers/auth-provider"
import { useXGUIToast } from "@/xgui"

export type ScopedMessageActionTarget = MessageReplyTarget & {
  avatar: string
  canCreateTopic: boolean
  canRevoke: boolean
  conversationId: string
  createdAt: string
}

export function useMessageSelectionActions({
  canCreateTopic,
  conversationId,
  isFocused,
  messages,
  onForward,
  onCreateTopic,
  onReply,
  onRevoked,
  resolveMentionLabel,
  server,
  topicArchived,
}: {
  canCreateTopic: boolean
  conversationId: string
  isFocused: boolean
  messages: PresentedMessage[]
  onCreateTopic: (target: ScopedMessageActionTarget) => void
  onForward: (target: ScopedMessageActionTarget) => void
  onReply: (target: ScopedMessageActionTarget) => void
  onRevoked: (messageId: string) => void
  resolveMentionLabel: MessageMentionLabelResolver
  server: AuthenticatedTarget
  topicArchived: boolean
}) {
  const router = useRouter()
  const xguiToast = useXGUIToast()
  const { invalidateSession } = useAuth()
  const revokeMessageMutation = useRevokeConversationMessage(
    server,
    conversationId
  )
  const revoke = useCallback(
    async (messageId: string) => {
      if (revokeMessageMutation.isPending) return
      xguiToast.show({
        duration: 0,
        message: "正在撤回消息",
        type: "loading",
      })
      try {
        await revokeMessageMutation.mutateAsync(messageId)
        xguiToast.hide()
        onRevoked(messageId)
        xguiToast.show({
          duration: 1_000,
          message: "消息已撤回",
          modal: false,
          type: "text",
        })
      } catch (error: unknown) {
        xguiToast.hide()
        if (isUnauthorizedError(error)) {
          void invalidateSession()
          router.replace("/server-management")
          return
        }
        xguiToast.show({
          duration: 1_000,
          message: error instanceof ApiRequestError
            ? error.message
            : "撤回消息失败，请重试。",
          modal: false,
          type: "text",
        })
      }
    },
    [
      invalidateSession,
      xguiToast,
      onRevoked,
      revokeMessageMutation,
      router,
    ]
  )

  useEffect(() => {
    if (!isFocused) return

    const subscription = addMessageSelectionActionListener((event) => {
      const message = messages.find(
        (candidate) => candidate.id === event.messageId
      )
      if (!message) return

      const target: ScopedMessageActionTarget = {
        author: message.author,
        avatar: message.avatar,
        canCreateTopic: canCreateTopic && !message.topic,
        canRevoke: message.canRevoke,
        conversationId,
        createdAt: message.createdAt,
        id: message.id,
        summary: formatClientMessageBodySummary(
          message.body,
          resolveMentionLabel
        ),
      }

      if (event.action === "copy") {
        void Clipboard.setStringAsync(target.summary)
          .then(() => {
            xguiToast.show({ message: "已复制", modal: false, type: "text", duration: 1_000 })
          })
          .catch(() => {
            xguiToast.show({ message: "复制失败", modal: false, type: "text", duration: 1_000 })
          })
        return
      }

      if (event.action === "reply") {
        if (!topicArchived) onReply(target)
        return
      }

      if (event.action === "forward") {
        onForward(target)
        return
      }

      if (event.action === "create_topic") {
        if (target.canCreateTopic) onCreateTopic(target)
        return
      }

      if (
        event.action !== "revoke" ||
        !message.canRevoke ||
        revokeMessageMutation.isPending
      ) {
        return
      }

      void revoke(message.id)
    })

    return () => subscription?.remove()
  }, [
    canCreateTopic,
    conversationId,
    invalidateSession,
    isFocused,
    messages,
    onForward,
    onCreateTopic,
    onReply,
    onRevoked,
    resolveMentionLabel,
    revokeMessageMutation,
    router,
    xguiToast,
    topicArchived,
    revoke,
  ])

  return { revoke, revoking: revokeMessageMutation.isPending }
}
