import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { Alert, AppState } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { YStack } from "tamagui"

import { ContentState } from "@/components/feedback/content-state"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import {
  PAGE_HEADER_HEIGHT,
  PageHeader,
} from "@/components/navigation/page-header"
import { ApiRequestError, isUnauthorizedError } from "@/data/api-client"
import {
  useConversationMessages,
  useMarkConversationRead,
  useSendConversationFileMessage,
  useSendConversationImageMessage,
  useSendConversationTextMessage,
  useSendConversationVoiceMessage,
} from "@/data/message-hooks"
import type {
  PreparedClientMessageUpload,
  PreparedClientVoiceMessage,
} from "@/data/message-upload"
import {
  openResourceExternally,
  useMessageResources,
} from "@/data/resources"
import {
  type EntityReference,
} from "@/domain/entities/entity-profile"
import {
  buildPresentedMessages,
  collectMessageResources,
  createMessageMentionLabelResolver,
  type MessageMentionLabelResolver,
} from "@/domain/messages/message-presenter"
import {
  MessageComposer,
  type MessageComposerHandle,
} from "@/features/conversation/message-composer"
import { MessageList } from "@/features/conversation/message-list"
import { createMentionCandidates } from "@/features/conversation/mention-model"
import {
  useAuth,
  useAuthenticatedSession,
} from "@/features/auth/auth-context"
import { useClientData } from "@/providers/client-data-provider"
import { buildEntityDetailHref } from "@/navigation/entity-details"
import { useRealtime } from "@/realtime/realtime-context"

const EMPTY_MENTION_RESOLVER: MessageMentionLabelResolver = () => undefined

export function ConversationScreen() {
  const params = useLocalSearchParams<{ conversationId: string }>()
  const conversationId = Array.isArray(params.conversationId)
    ? (params.conversationId[0] ?? "")
    : (params.conversationId ?? "")
  const router = useRouter()
  const isFocused = useIsFocused()
  const insets = useSafeAreaInsets()
  const { invalidateSession } = useAuth()
  const { activateConversation } = useRealtime()
  const session = useAuthenticatedSession()
  const [appIsActive, setAppIsActive] = useState(
    () => AppState.currentState === "active"
  )
  const appIsActiveRef = useRef(appIsActive)
  const composerRef = useRef<MessageComposerHandle>(null)
  const { contacts, conversations, currentUser, currentUserError, isReady } =
    useClientData()
  const conversation = conversations.find((item) => item.id === conversationId)
  const mentionCandidates = useMemo(
    () =>
      conversation?.type === "group"
        ? createMentionCandidates(conversation.members ?? [])
        : [],
    [conversation]
  )
  const messagesQuery = useConversationMessages(session, conversationId)
  const sendTextMutation = useSendConversationTextMessage(
    session,
    conversationId
  )
  const sendFileMutation = useSendConversationFileMessage(
    session,
    conversationId
  )
  const sendImageMutation = useSendConversationImageMessage(
    session,
    conversationId
  )
  const sendVoiceMutation = useSendConversationVoiceMessage(
    session,
    conversationId
  )
  const isSending =
    sendTextMutation.isPending ||
    sendFileMutation.isPending ||
    sendImageMutation.isPending ||
    sendVoiceMutation.isPending
  const { mutateAsync: markRead } = useMarkConversationRead(
    session,
    conversationId
  )
  const readStateConversationId = useRef("")
  const confirmedReadSeq = useRef(0)
  const requestedReadSeq = useRef(0)
  const messageResources = useMemo(
    () => collectMessageResources(messagesQuery.messages),
    [messagesQuery.messages]
  )
  const resources = useMessageResources(session, messageResources)
  const resolveMentionLabel = useMemo(
    () =>
      conversation && currentUser
        ? createMessageMentionLabelResolver({
            contacts,
            conversation,
            currentUser,
          })
        : EMPTY_MENTION_RESOLVER,
    [contacts, conversation, currentUser]
  )
  const presentedMessages = useMemo(
    () =>
      conversation && currentUser
        ? buildPresentedMessages({
            contacts,
            conversation,
            currentUser,
            messages: messagesQuery.messages,
            resolveMentionLabel,
          })
        : [],
    [
      contacts,
      conversation,
      currentUser,
      messagesQuery.messages,
      resolveMentionLabel,
    ]
  )

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      const active = status === "active"
      appIsActiveRef.current = active
      setAppIsActive(active)
    })

    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (!isFocused || !conversationId) return
    return activateConversation(conversationId)
  }, [activateConversation, conversationId, isFocused])

  useEffect(() => {
    const error = messagesQuery.error ?? currentUserError
    if (isUnauthorizedError(error)) {
      void invalidateSession()
      router.replace("/init")
    }
  }, [currentUserError, invalidateSession, messagesQuery.error, router])

  useEffect(() => {
    if (isReady && !conversation) {
      router.replace("/(app)/(tabs)/messages")
    }
  }, [conversation, isReady, router])

  useEffect(() => {
    if (!conversation) return

    if (readStateConversationId.current !== conversationId) {
      readStateConversationId.current = conversationId
      confirmedReadSeq.current = conversation.lastReadSeq
      requestedReadSeq.current = conversation.lastReadSeq
    }

    if (!isFocused || !appIsActiveRef.current) return

    const newestSeq = Math.max(
      conversation.lastMessageSeq,
      messagesQuery.messages[0]?.seq ?? 0
    )
    const hasUnread = conversation.unreadCount > 0

    function markLatestRead() {
      if (!appIsActiveRef.current) return
      const hasUnreadProgress =
        hasUnread || newestSeq > requestedReadSeq.current
      if (!hasUnreadProgress) return

      requestedReadSeq.current = Math.max(
        requestedReadSeq.current,
        newestSeq
      )
      void markRead(newestSeq)
        .then((result) => {
          confirmedReadSeq.current = Math.max(
            confirmedReadSeq.current,
            result.lastReadSeq
          )
        })
        .catch(() => {
          if (requestedReadSeq.current === newestSeq) {
            requestedReadSeq.current = confirmedReadSeq.current
          }
        })
    }

    markLatestRead()
    const interval = setInterval(markLatestRead, 20_000)
    return () => clearInterval(interval)
  }, [
    appIsActive,
    conversation,
    conversationId,
    isFocused,
    markRead,
    messagesQuery.messages,
  ])

  async function handleSend(content: string) {
    try {
      await sendTextMutation.mutateAsync({
        clientMessageId: createClientMessageId(),
        content,
      })
      return true
    } catch (error: unknown) {
      Alert.alert(
        "发送失败",
        error instanceof ApiRequestError ? error.message : "消息发送失败，请重试。"
      )
      return false
    }
  }

  async function handleSendUpload(selection: PreparedClientMessageUpload) {
    try {
      if (selection.kind === "image") {
        await sendImageMutation.mutateAsync({
          clientMessageId: createClientMessageId(),
          image: selection.upload,
        })
      } else {
        await sendFileMutation.mutateAsync({
          clientMessageId: createClientMessageId(),
          file: selection.upload,
        })
      }
      return true
    } catch (error: unknown) {
      Alert.alert(
        selection.kind === "image" ? "图片发送失败" : "文件发送失败",
        error instanceof ApiRequestError
          ? error.message
          : "消息发送失败，请重试。"
      )
      return false
    }
  }

  async function handleSendVoice(recording: PreparedClientVoiceMessage) {
    try {
      await sendVoiceMutation.mutateAsync({
        clientMessageId: createClientMessageId(),
        durationMS: recording.durationMS,
        voice: recording.upload,
      })
      return true
    } catch (error: unknown) {
      Alert.alert(
        "语音发送失败",
        error instanceof ApiRequestError
          ? error.message
          : "消息发送失败，请重试。"
      )
      return false
    }
  }

  function handleRefresh() {
    void messagesQuery.refetch()
  }

  function handleLoadOlder() {
    if (!messagesQuery.hasOlder || messagesQuery.isFetchingOlder) return
    void messagesQuery.fetchOlder()
  }

  function handleAvatarPress(sender: EntityReference) {
    router.push(buildEntityDetailHref(sender))
  }

  function handleAvatarLongPress(sender: EntityReference) {
    if (conversation?.type !== "group" || sender.type === "group") return

    const label = resolveMentionLabel({
      id: sender.id,
      type: sender.type,
    })?.trim()
    if (!label) return

    composerRef.current?.insertMention({
      id: sender.id,
      label,
      targetType: sender.type,
    })
  }

  async function handleResourcePress(fileId: string) {
    try {
      const resource = await resources.ensure(fileId)
      await openResourceExternally(resource)
    } catch (error: unknown) {
      Alert.alert(
        "无法打开文件",
        error instanceof Error ? error.message : "文件下载失败，请重试。"
      )
    }
  }

  async function handleVoiceResourcePress(fileId: string) {
    try {
      await resources.ensure(fileId)
    } catch (error: unknown) {
      Alert.alert(
        "无法播放语音",
        error instanceof Error ? error.message : "语音下载失败，请重试。"
      )
    }
  }

  return (
    <YStack bg="$background" flex={1}>
      <PageHeader
        onBackPress={() => router.back()}
        title={conversation?.name ?? "对话"}
      />

      <KeyboardAwareScreen
        contentBackground="$color1"
        edges={["bottom"]}
        keyboardVerticalOffset={insets.top + PAGE_HEADER_HEIGHT}
        scrollable={false}
      >
        {!conversation ? (
          <ContentState message="该会话不存在或已被移除" />
        ) : !currentUser ? (
          <ContentState loading message="正在加载用户信息" />
        ) : (
          <>
            <MessageList
              conversationId={conversation.id}
              currentUserId={currentUser.id}
              error={messagesQuery.error}
              hasOlder={messagesQuery.hasOlder}
              isFetchingOlder={messagesQuery.isFetchingOlder}
              isLoading={messagesQuery.isLoading}
              isRefreshing={messagesQuery.isRefreshing}
              messages={presentedMessages}
              onAvatarLongPress={
                conversation.type === "group"
                  ? handleAvatarLongPress
                  : undefined
              }
              onAvatarPress={handleAvatarPress}
              onContentTouch={() =>
                composerRef.current?.dismissAccessory()
              }
              onLoadOlder={handleLoadOlder}
              onRefresh={handleRefresh}
              onResourceError={(fileId) =>
                void resources.reload(fileId).catch(() => undefined)
              }
              onResourcePress={(fileId) => void handleResourcePress(fileId)}
              onVoiceResourcePress={(fileId) =>
                void handleVoiceResourcePress(fileId)
              }
              onMentionPress={handleAvatarPress}
              resolveMentionLabel={resolveMentionLabel}
              resourceStates={resources.states}
              server={session}
            />
            <MessageComposer
              disabled={isSending}
              mentionCandidates={mentionCandidates}
              onSend={handleSend}
              onSendUpload={handleSendUpload}
              onSendVoice={handleSendVoice}
              ref={composerRef}
              server={session}
            />
          </>
        )}
      </KeyboardAwareScreen>
    </YStack>
  )
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
