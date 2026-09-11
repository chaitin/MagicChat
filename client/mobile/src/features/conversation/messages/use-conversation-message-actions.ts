import { useXGUIToast } from "@/xgui"
import { useRouter } from "expo-router"
import { useEffect, useRef, useState } from "react"

import { ApiRequestError, isUnauthorizedError } from "@/data/api-client"
import {
  useForwardConversationMessage,
  useSendConversationFileMessage,
  useSendConversationImageMessage,
  useSendConversationTextMessage,
  useSendConversationVideoMessage,
  useSendConversationVoiceMessage,
  useSetConversationMessageReaction,
  useSubmitConversationMessageChoiceResponse,
} from "@/data/messages/message-hooks"
import type {
  PreparedClientMessageUpload,
  PreparedClientVoiceMessage,
} from "@/data/messages/message-upload"
import type { AuthenticatedTarget } from "@/core/server-target"
import type { ClientMessage } from "@/core/models"
import {
  createOptimisticMessage,
  markOptimisticMessageFailed,
  reconcileOptimisticMessages,
  releaseAllDescriptorCleanups,
  releaseDescriptorCleanup,
  type OptimisticMessage,
  type OptimisticSendDescriptor,
} from "@/features/conversation/optimistic-message-model"
import { useAuth } from "@/providers/auth-provider"

export function useConversationMessageActions({
  conversationId,
  confirmedMessages,
  forwardMessageId,
  onReplySent,
  replyToMessageId,
  server,
}: {
  conversationId: string
  confirmedMessages: ClientMessage[]
  forwardMessageId: string | undefined
  onReplySent: (messageId: string) => void
  replyToMessageId: string | undefined
  server: AuthenticatedTarget
}) {
  const router = useRouter()
  const toast = useXGUIToast()
  const { invalidateSession } = useAuth()
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([])
  const confirmedMessagesRef = useRef(confirmedMessages)
  const retryingIdsRef = useRef(new Set<string>())
  const descriptorsRef = useRef(new Map<string, OptimisticSendDescriptor>())
  confirmedMessagesRef.current = confirmedMessages

  useEffect(() => {
    const confirmedIds = new Set(confirmedMessages.map((message) => message.clientMessageId))
    for (const clientMessageId of confirmedIds) {
      releaseDescriptorCleanup(descriptorsRef.current, clientMessageId)
    }
    let active = true
    queueMicrotask(() => {
      if (active) setOptimisticMessages((current) => reconcileOptimisticMessages(current, confirmedMessages))
    })
    return () => { active = false }
  }, [confirmedMessages])

  useEffect(
    () => () => {
      releaseAllDescriptorCleanups(descriptorsRef.current)
    },
    [conversationId, server.id, server.url]
  )

  const sendTextMutation = useSendConversationTextMessage(
    server,
    conversationId
  )
  const sendFileMutation = useSendConversationFileMessage(
    server,
    conversationId
  )
  const sendImageMutation = useSendConversationImageMessage(
    server,
    conversationId
  )
  const sendVideoMutation = useSendConversationVideoMessage(
    server,
    conversationId
  )
  const sendVoiceMutation = useSendConversationVoiceMessage(
    server,
    conversationId
  )
  const setReactionMutation = useSetConversationMessageReaction(
    server,
    conversationId
  )
  const submitChoiceMutation = useSubmitConversationMessageChoiceResponse(
    server,
    conversationId
  )
  const forwardMutation = useForwardConversationMessage(
    server,
    conversationId
  )
  const isSending = false

  async function enqueue(descriptor: OptimisticSendDescriptor) {
    descriptorsRef.current.set(descriptor.clientMessageId, descriptor)
    setOptimisticMessages((current) => {
      const newestSeq = confirmedMessagesRef.current.reduce((maximum, message) => Math.max(maximum, message.seq), 0)
      return [{ descriptor, message: createOptimisticMessage(server.userId, conversationId, descriptor, newestSeq + current.length + 1), status: "sending" }, ...current]
    })
    if (descriptor.replyToMessageId) onReplySent(descriptor.replyToMessageId)
    void performSend(descriptor)
    return true
  }

  async function performSend(descriptor: OptimisticSendDescriptor) {
    if (retryingIdsRef.current.has(descriptor.clientMessageId)) return
    retryingIdsRef.current.add(descriptor.clientMessageId)
    setOptimisticMessages((current) => current.map((item) => item.message.clientMessageId === descriptor.clientMessageId ? { ...item, status: "sending" } : item))
    try {
      if (descriptor.kind === "text") await sendTextMutation.mutateAsync(descriptor)
      else if (descriptor.kind === "image") await sendImageMutation.mutateAsync({ clientMessageId: descriptor.clientMessageId, image: descriptor.upload, replyToMessageId: descriptor.replyToMessageId })
      else if (descriptor.kind === "file") await sendFileMutation.mutateAsync({ clientMessageId: descriptor.clientMessageId, file: descriptor.upload, replyToMessageId: descriptor.replyToMessageId })
      else if (descriptor.kind === "video") await sendVideoMutation.mutateAsync({ clientMessageId: descriptor.clientMessageId, replyToMessageId: descriptor.replyToMessageId, video: descriptor.upload })
      else await sendVoiceMutation.mutateAsync({ clientMessageId: descriptor.clientMessageId, durationMS: descriptor.durationMS, replyToMessageId: descriptor.replyToMessageId, transcript: descriptor.transcript, voice: descriptor.upload })
    } catch (error: unknown) {
      setOptimisticMessages((current) => markOptimisticMessageFailed(current, descriptor.clientMessageId, confirmedMessagesRef.current))
      if (
        error instanceof ApiRequestError &&
        error.code === "direct_message_unavailable"
      ) {
        toast.show({
          duration: 1_500,
          message: error.message,
          modal: false,
          type: "error",
        })
      }
    } finally {
      retryingIdsRef.current.delete(descriptor.clientMessageId)
    }
  }

  function sendText(content: string) {
    return enqueue({ clientMessageId: createClientMessageId(), content, kind: "text", replyToMessageId })
  }

  function retryMessage(clientMessageId: string) {
    const descriptor = descriptorsRef.current.get(clientMessageId)
    if (descriptor) void performSend(descriptor)
  }

  function sendUpload(selection: PreparedClientMessageUpload) {
    const common = {
      cleanup: selection.cleanup,
      clientMessageId: createClientMessageId(),
      replyToMessageId,
      upload: selection.upload,
    }
    if (selection.kind === "image") {
      return enqueue({
        ...common,
        height: selection.height,
        kind: "image",
        width: selection.width,
      })
    }
    if (selection.kind === "video") {
      return enqueue({ ...common, kind: "video" })
    }
    return enqueue({ ...common, kind: "file" })
  }

  function sendVoice(recording: PreparedClientVoiceMessage) {
    return enqueue({ cleanup: recording.cleanup, clientMessageId: createClientMessageId(), durationMS: recording.durationMS, kind: "voice", replyToMessageId, transcript: recording.transcript, upload: recording.upload })
  }

  async function setReaction(
    messageId: string,
    text: string,
    reacted: boolean
  ) {
    try {
      await setReactionMutation.mutateAsync({ messageId, reacted, text })
    } catch (error: unknown) {
      if (isUnauthorizedError(error)) {
        void invalidateSession()
        router.replace("/server-management")
      } else {
        toast.show({ message: error instanceof ApiRequestError
            ? error.message
            : "更新消息表情失败，请重试。", modal: false, type: "text", duration: 1_000 })
      }
      throw error
    }
  }

  async function respondChoice(messageId: string, optionIds: string[]) {
    try {
      await submitChoiceMutation.mutateAsync({ messageId, optionIds })
    } catch (error: unknown) {
      if (isUnauthorizedError(error)) {
        void invalidateSession()
        router.replace("/server-management")
      }
      throw error
    }
  }

  async function forward(targetConversationIds: string[]) {
    if (!forwardMessageId || forwardMutation.isPending) return false

    try {
      const result = await forwardMutation.mutateAsync({
        clientForwardId: createClientMessageId(),
        messageId: forwardMessageId,
        targetConversationIds,
      })
      if (result.sentCount === 0) {
        const firstFailure = result.results.find(
          (candidate) => candidate.status === "failed"
        )
        toast.show({ message: firstFailure?.status === "failed"
            ? firstFailure.error.message
            : "转发消息失败，请重试。", modal: false, type: "text", duration: 1_000 })
        return false
      }

      toast.show({ message: result.failedCount > 0
          ? `已转发到 ${result.sentCount} 个会话，${result.failedCount} 个失败`
          : `已转发到 ${result.sentCount} 个会话`, modal: false, type: "text", duration: 1_000 })
      return true
    } catch (error: unknown) {
      if (isUnauthorizedError(error)) {
        void invalidateSession()
        router.replace("/server-management")
      } else {
        toast.show({ message: error instanceof ApiRequestError
            ? error.message
            : "转发消息失败，请重试。", modal: false, type: "text", duration: 1_000 })
      }
      return false
    }
  }

  return {
    forward,
    isSending,
    optimisticMessages,
    retryMessage,
    respondChoice,
    sendText,
    sendUpload,
    sendVoice,
    setReaction,
  }
}

function createClientMessageId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }

  let seed = Date.now()
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (value) => {
    const random = (seed + Math.random() * 16) % 16 | 0
    seed = Math.floor(seed / 16)
    return (value === "x" ? random : (random & 0x3) | 0x8).toString(16)
  })
}
