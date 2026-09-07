import { useCallback, useRef, type RefObject } from "react"
import { toast } from "sonner"

import {
  sendConversationFileMessage,
  sendConversationImageMessage,
  sendConversationVoiceMessage,
  sendConversationLinkMessage,
  sendConversationMarkdownMessage,
  sendConversationCardMessage,
  sendConversationEntityCardMessage,
  sendConversationTextMessage,
} from "@/lib/client-data-api"
import type { ClientCardSendInput } from "@/lib/client-data-api"
import type {
  ClientConversationMessageState,
  ClientDataContextValue,
  SendConversationImageOptions,
  SendConversationMessageOptions,
} from "@/lib/client-data-context"
import { getClientDataErrorMessage } from "@/lib/client-data-state"
import { createClientMessageId } from "@/lib/message-id"
import type { VoiceMessageRecording } from "@/lib/voice-message"

export function useConversationSenders({
  currentUserId,
  conversationMessageStatesRef,
  getConversationAccountGeneration,
  mergeIncomingConversationMessage,
  updateConversationMessageState,
}: {
  currentUserId: string
  conversationMessageStatesRef: RefObject<
    Record<string, ClientConversationMessageState>
  >
  getConversationAccountGeneration: () => number
  mergeIncomingConversationMessage: ClientDataContextValue["mergeIncomingConversationMessage"]
  updateConversationMessageState: (
    conversationId: string,
    updater: (
      state: ClientConversationMessageState
    ) => ClientConversationMessageState
  ) => void
}) {
  const attemptsRef = useRef(new Set<string>())
  const sendOptimistic = useCallback(
    async function runOptimistic(
      conversationId: string,
      clientMessageId: string,
      body: import("@/lib/client-data-api").ClientMessage["body"],
      replyToMessageId: string | undefined,
      request: () => Promise<import("@/lib/client-data-api").ClientMessage>,
      failureText: string
    ) {
      if (attemptsRef.current.has(clientMessageId)) return null
      const retry = () =>
        void runOptimistic(
          conversationId,
          clientMessageId,
          body,
          replyToMessageId,
          request,
          failureText
        )
      attemptsRef.current.add(clientMessageId)
      const accountGeneration = getConversationAccountGeneration()
      const state = conversationMessageStatesRef.current[conversationId]
      const temporary = {
        body,
        clientMessageId,
        conversationId,
        createdAt: new Date().toISOString(),
        deliveryStatus: "sending" as const,
        id: `optimistic:${clientMessageId}`,
        reactionVersion: 0,
        reactions: [],
        replyToMessageId,
        retry,
        sender: { id: currentUserId, type: "user" as const },
        seq:
          Math.max(
            state?.latestKnownSeq ?? 0,
            ...(state?.messages.map((item) => item.seq) ?? [0])
          ) + 1,
      }
      mergeIncomingConversationMessage(temporary, { markLoaded: true })
      try {
        const message = await request()
        if (accountGeneration !== getConversationAccountGeneration()) return null
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error) {
        if (accountGeneration !== getConversationAccountGeneration()) return null
        mergeIncomingConversationMessage(
          { ...temporary, deliveryStatus: "failed" },
          { markLoaded: true }
        )
        toast.error(getClientDataErrorMessage(error, failureText))
        return null
      } finally {
        attemptsRef.current.delete(clientMessageId)
      }
    },
    [
      conversationMessageStatesRef,
      currentUserId,
      getConversationAccountGeneration,
      mergeIncomingConversationMessage,
    ]
  )
  const sendConversationText = useCallback(
    async (
      conversationId: string,
      content: string,
      options: SendConversationMessageOptions = {}
    ) => {
      const trimmedContent = content.trim()
      if (!conversationId || !trimmedContent) return null
      const clientMessageId = createClientMessageId()
      return sendOptimistic(
        conversationId, clientMessageId, { type: "text", content: trimmedContent },
        options.replyToMessageId,
        () => sendConversationTextMessage(conversationId, {
          clientMessageId, content: trimmedContent, replyToMessageId: options.replyToMessageId,
        }),
        "发送消息失败"
      )
    },
    [sendOptimistic]
  )

  const sendConversationMarkdown = useCallback(
    async (
      conversationId: string,
      content: string,
      options: SendConversationMessageOptions = {}
    ) => {
      const trimmedContent = content.trim()
      if (!conversationId || !trimmedContent) return null
      const clientMessageId = createClientMessageId()
      return sendOptimistic(
        conversationId, clientMessageId, { type: "markdown", content: trimmedContent },
        options.replyToMessageId,
        () => sendConversationMarkdownMessage(conversationId, {
          clientMessageId, content: trimmedContent, replyToMessageId: options.replyToMessageId,
        }),
        "发送富文本消息失败"
      )
    },
    [sendOptimistic]
  )

  const sendConversationLink = useCallback(
    async (
      conversationId: string,
      url: string,
      options: SendConversationMessageOptions = {}
    ) => {
      const trimmedURL = url.trim()
      if (!conversationId || !trimmedURL) return null
      const clientMessageId = createClientMessageId()
      return sendOptimistic(
        conversationId, clientMessageId, { type: "link", title: trimmedURL, url: trimmedURL },
        options.replyToMessageId,
        () => sendConversationLinkMessage(conversationId, {
          clientMessageId, url: trimmedURL, replyToMessageId: options.replyToMessageId,
        }),
        "发送链接失败"
      )
    },
    [sendOptimistic]
  )

  const sendConversationCard = useCallback(
    async (
      conversationId: string,
      card: ClientCardSendInput,
      options: SendConversationMessageOptions = {}
    ) => {
      const state = conversationMessageStatesRef.current[conversationId]
      if (!conversationId || !isValidCardSendInput(card) || state?.sending) {
        return null
      }

      const clientMessageId = createClientMessageId()
      const accountGeneration = getConversationAccountGeneration()
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        sending: true,
      }))

      try {
        const message =
          card.type === "entity_card"
            ? await sendConversationEntityCardMessage(conversationId, {
                clientMessageId,
                entityId: card.entityId.trim(),
                entityType: card.entityType,
                replyToMessageId: options.replyToMessageId,
              })
            : await sendConversationCardMessage(conversationId, {
                clientMessageId,
                description: card.description.trim(),
                replyToMessageId: options.replyToMessageId,
                title: card.title.trim(),
                url: card.url.trim(),
              })
        if (accountGeneration !== getConversationAccountGeneration()) return null
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error: unknown) {
        if (accountGeneration === getConversationAccountGeneration()) {
          toast.error(getClientDataErrorMessage(error, "发送卡片失败"))
        }
        return null
      } finally {
        if (accountGeneration === getConversationAccountGeneration()) {
          updateConversationMessageState(conversationId, (currentState) => ({
            ...currentState,
            sending: false,
          }))
        }
      }
    },
    [
      conversationMessageStatesRef,
      getConversationAccountGeneration,
      mergeIncomingConversationMessage,
      updateConversationMessageState,
    ]
  )

  const sendConversationFile = useCallback(
    async (
      conversationId: string,
      file: File,
      options: SendConversationMessageOptions = {}
    ) => {
      const state = conversationMessageStatesRef.current[conversationId]
      if (!conversationId || state?.sending) {
        return null
      }

      const clientMessageId = createClientMessageId()
      const accountGeneration = getConversationAccountGeneration()
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        sending: true,
      }))

      try {
        const message = await sendConversationFileMessage(conversationId, {
          clientMessageId,
          file,
          replyToMessageId: options.replyToMessageId,
        })
        if (accountGeneration !== getConversationAccountGeneration()) return null
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error: unknown) {
        if (accountGeneration === getConversationAccountGeneration()) {
          toast.error(getClientDataErrorMessage(error, "发送文件失败"))
        }
        return null
      } finally {
        if (accountGeneration === getConversationAccountGeneration()) {
          updateConversationMessageState(conversationId, (currentState) => ({
            ...currentState,
            sending: false,
          }))
        }
      }
    },
    [
      conversationMessageStatesRef,
      getConversationAccountGeneration,
      mergeIncomingConversationMessage,
      updateConversationMessageState,
    ]
  )

  const sendConversationImage = useCallback(
    async (
      conversationId: string,
      image: File,
      options: SendConversationImageOptions = {}
    ) => {
      const state = conversationMessageStatesRef.current[conversationId]
      if (!conversationId || state?.sending) {
        return null
      }

      const clientMessageId = createClientMessageId()
      const accountGeneration = getConversationAccountGeneration()
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        sending: true,
      }))

      try {
        const message = await sendConversationImageMessage(conversationId, {
          caption: options.caption,
          captionType: options.captionType,
          clientMessageId,
          image,
          replyToMessageId: options.replyToMessageId,
        })
        if (accountGeneration !== getConversationAccountGeneration()) return null
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error: unknown) {
        if (accountGeneration === getConversationAccountGeneration()) {
          toast.error(getClientDataErrorMessage(error, "发送图片失败"))
        }
        return null
      } finally {
        if (accountGeneration === getConversationAccountGeneration()) {
          updateConversationMessageState(conversationId, (currentState) => ({
            ...currentState,
            sending: false,
          }))
        }
      }
    },
    [
      conversationMessageStatesRef,
      getConversationAccountGeneration,
      mergeIncomingConversationMessage,
      updateConversationMessageState,
    ]
  )

  const sendConversationVoice = useCallback(
    async (
      conversationId: string,
      voice: VoiceMessageRecording,
      options: SendConversationMessageOptions = {}
    ) => {
      const state = conversationMessageStatesRef.current[conversationId]
      if (!conversationId || state?.sending) {
        return null
      }

      const clientMessageId = createClientMessageId()
      const accountGeneration = getConversationAccountGeneration()
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        sending: true,
      }))

      try {
        const message = await sendConversationVoiceMessage(conversationId, {
          clientMessageId,
          durationMS: voice.durationMS,
          replyToMessageId: options.replyToMessageId,
          transcript: voice.transcript,
          voice: voice.blob,
        })
        if (accountGeneration !== getConversationAccountGeneration()) return null
        mergeIncomingConversationMessage(message, { markLoaded: true })
        return message
      } catch (error: unknown) {
        if (accountGeneration === getConversationAccountGeneration()) {
          toast.error(getClientDataErrorMessage(error, "发送语音失败"))
        }
        return null
      } finally {
        if (accountGeneration === getConversationAccountGeneration()) {
          updateConversationMessageState(conversationId, (currentState) => ({
            ...currentState,
            sending: false,
          }))
        }
      }
    },
    [
      conversationMessageStatesRef,
      getConversationAccountGeneration,
      mergeIncomingConversationMessage,
      updateConversationMessageState,
    ]
  )

  return {
    sendConversationFile,
    sendConversationImage,
    sendConversationLink,
    sendConversationMarkdown,
    sendConversationCard,
    sendConversationText,
    sendConversationVoice,
  }
}

function isValidCardSendInput(card: ClientCardSendInput) {
  if (card.type === "entity_card") {
    return Boolean(card.entityId.trim())
  }
  return Boolean(
    card.title.trim() && card.description.trim() && card.url.trim()
  )
}
