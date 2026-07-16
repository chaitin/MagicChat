import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { Alert, AppState } from "react-native"
import { Button, Paragraph, Spinner, YStack } from "tamagui"

import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { PageHeader } from "@/components/navigation/page-header"
import { ApiRequestError, isUnauthorizedError } from "@/data/api-client"
import {
  useConversationMessages,
  useMarkConversationRead,
  useSendConversationTextMessage,
  useTemporaryFileUrls,
} from "@/data/message-hooks"
import {
  getConversationEntityReference,
  type EntityReference,
} from "@/domain/entities/entity-profile"
import {
  buildPresentedMessages,
  collectMessageFileIds,
  createMessageMentionLabelResolver,
  type MessageMentionLabelResolver,
} from "@/domain/messages/message-presenter"
import { ConversationHeaderAvatar } from "@/features/conversation/conversation-header-avatar"
import { MessageComposer } from "@/features/conversation/message-composer"
import { MessageList } from "@/features/conversation/message-list"
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
  const { invalidateSession } = useAuth()
  const { activateConversation } = useRealtime()
  const session = useAuthenticatedSession()
  const [appIsActive, setAppIsActive] = useState(
    () => AppState.currentState === "active"
  )
  const appIsActiveRef = useRef(appIsActive)
  const { contacts, conversations, currentUser, currentUserError, isReady } =
    useClientData()
  const conversation = conversations.find((item) => item.id === conversationId)
  const conversationEntityReference =
    conversation && currentUser
      ? getConversationEntityReference(conversation, currentUser.id)
      : null
  const messagesQuery = useConversationMessages(session, conversationId)
  const sendMutation = useSendConversationTextMessage(
    session,
    conversationId
  )
  const { mutateAsync: markRead } = useMarkConversationRead(
    session,
    conversationId
  )
  const readStateConversationId = useRef("")
  const confirmedReadSeq = useRef(0)
  const requestedReadSeq = useRef(0)
  const fileIds = useMemo(
    () => collectMessageFileIds(messagesQuery.messages),
    [messagesQuery.messages]
  )
  const fileUrlsQuery = useTemporaryFileUrls(session, fileIds)
  const fileUrls = useMemo(
    () =>
      new Map(
        (fileUrlsQuery.data ?? []).map((item) => [item.fileId, item.url] as const)
      ),
    [fileUrlsQuery.data]
  )
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
      await sendMutation.mutateAsync({
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

  return (
    <YStack bg="$background" flex={1}>
      <PageHeader
        onBackPress={() => router.back()}
        title={conversation?.name ?? "对话"}
        titleLeading={
          conversation && conversationEntityReference ? (
            <Button
              aria-label={`查看${conversation.name}资料`}
              chromeless
              height="$3"
              onPress={() => handleAvatarPress(conversationEntityReference)}
              p={0}
              width="$3"
            >
              <ConversationHeaderAvatar
                conversation={conversation}
                serverUrl={session.url}
              />
            </Button>
          ) : undefined
        }
      />

      <KeyboardAwareScreen edges={["bottom"]} scrollable={false}>
        {!conversation ? (
          <YStack flex={1} items="center" justify="center" p="$6">
            <Paragraph color="$color10">该会话不存在或已被移除</Paragraph>
          </YStack>
        ) : !currentUser ? (
          <YStack flex={1} gap="$2" items="center" justify="center">
            <Spinner />
            <Paragraph color="$color10">正在加载用户信息</Paragraph>
          </YStack>
        ) : (
          <>
            <MessageList
              conversationId={conversation.id}
              error={messagesQuery.error}
              fileUrls={fileUrls}
              fileUrlsLoading={fileUrlsQuery.isLoading}
              hasOlder={messagesQuery.hasOlder}
              isFetchingOlder={messagesQuery.isFetchingOlder}
              isLoading={messagesQuery.isLoading}
              isRefreshing={messagesQuery.isRefreshing}
              messages={presentedMessages}
              onAvatarPress={handleAvatarPress}
              onLoadOlder={handleLoadOlder}
              onRefresh={handleRefresh}
              resolveMentionLabel={resolveMentionLabel}
              serverUrl={session.url}
            />
            <MessageComposer
              disabled={sendMutation.isPending}
              onSend={handleSend}
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
