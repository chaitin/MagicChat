// Tabler exposes per-icon runtime entry points without per-icon declarations.
// eslint-disable-next-line import/no-unresolved
import IconDots from "@tabler/icons-react-native/IconDots"
import * as Haptics from "expo-haptics"
import {
  useIsFocused,
  useLocalSearchParams,
  useRouter,
} from "expo-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Alert, Keyboard, Platform } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { SizableText, YStack } from "tamagui"

import { ContentState } from "@/components/feedback/content-state"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import {
  APP_HEADER_HEIGHT,
  AppHeader,
} from "@/components/navigation/app-header"
import type { ClientConversation } from "@/core/models"
import { ApiRequestError, isUnauthorizedError } from "@/data/api-client"
import {
  useConversationMessages,
  useMarkConversationRead,
} from "@/data/messages/message-hooks"
import {
  openResourceExternally,
  useMessageResources,
} from "@/data/resources"
import { conversationManager } from "@/data/conversations"
import {
  useConversationTopic,
  useCreateConversationTopic,
} from "@/data/conversations/topic-hooks"
import { type EntityReference } from "@/domain/entities/entity-profile"
import {
  buildPresentedMessages,
  buildPresentedTopicSourceMessage,
  collectMessageResources,
  collectMessageUserIds,
  createMessageMentionLabelResolver,
  formatClientMessageBodySummary,
  type MessageMentionLabelResolver,
  type PresentedMessage,
} from "@/domain/messages/message-presenter"
import { shouldShowMessageChoiceResponseCounts } from "@/domain/messages/message-choices"
import {
  MessageComposer,
  type MessageComposerHandle,
} from "@/features/conversation/composer/message-composer"
import { ForwardMessageSheet } from "@/features/conversation/forward-message-sheet"
import { MessageList } from "@/features/conversation/messages/message-list"
import { useTargetMessageNavigation } from "@/features/conversation/messages/use-target-message-navigation"
import { mergeOptimisticMessages } from "@/features/conversation/optimistic-message-model"
import { createMentionCandidates } from "@/features/conversation/composer/mention-model"
import { useConversationReadSync } from "@/features/conversation/use-conversation-read-sync"
import { useConversationNavigation } from "@/features/conversation/use-conversation-navigation"
import {
  type ScopedMessageActionTarget,
  useMessageSelectionActions,
} from "@/features/conversation/messages/use-message-selection-actions"
import { useConversationMessageActions } from "@/features/conversation/messages/use-conversation-message-actions"
import {
  useAuth,
  useAuthenticatedSession,
} from "@/providers/auth-provider"
import {
  buildConversationDetailsHref,
} from "@/navigation/conversations"
import { buildEntityDetailHref } from "@/navigation/entity-details"
import { buildAttachmentImagePreviewHref } from "@/navigation/image-preview"
import {
  hydrateClientConversationUsers,
  useClientData,
} from "@/providers/client-data-provider"
import { useRealtime } from "@/realtime/realtime-context"
import {
  XGUIActionSheet,
  XGUIBadge,
  useXGUITheme,
  useXGUIToast,
} from "@/xgui"

const EMPTY_MENTION_RESOLVER: MessageMentionLabelResolver = () => undefined

export function ConversationScreen() {
  const params = useLocalSearchParams<{
    conversationId: string
    messageId?: string
    parentConversationId?: string
    topic?: string
  }>()
  const conversationId = Array.isArray(params.conversationId)
    ? (params.conversationId[0] ?? "")
    : (params.conversationId ?? "")
  const parentConversationId = Array.isArray(params.parentConversationId)
    ? (params.parentConversationId[0] ?? "")
    : (params.parentConversationId ?? "")
  const targetMessageId = Array.isArray(params.messageId)
    ? (params.messageId[0] ?? "")
    : (params.messageId ?? "")
  const router = useRouter()
  const { colors } = useXGUITheme()
  const loadingToast = useXGUIToast()
  const isFocused = useIsFocused()
  const insets = useSafeAreaInsets()
  const { invalidateSession } = useAuth()
  const { activateConversation, ready: realtimeReady } = useRealtime()
  const session = useAuthenticatedSession()
  const composerRef = useRef<MessageComposerHandle>(null)
  const [forwardMessageState, setForwardMessage] =
    useState<ScopedMessageActionTarget | null>(null)
  const [forwardSheetOpen, setForwardSheetOpen] = useState(false)
  const [replyTargetState, setReplyTarget] =
    useState<ScopedMessageActionTarget | null>(null)
  const [messageActionTarget, setMessageActionTarget] =
    useState<ScopedMessageActionTarget | null>(null)
  const [messageActionSheetOpen, setMessageActionSheetOpen] = useState(false)
  const [unlistedConversation, setUnlistedConversation] =
    useState<ClientConversation>()
  const forwardMessage =
    forwardMessageState?.conversationId === conversationId
      ? forwardMessageState
      : null
  const replyTarget =
    replyTargetState?.conversationId === conversationId
      ? replyTargetState
      : null
  const requestForwardSheetClose = useCallback(() => {
    setForwardSheetOpen(false)
  }, [])
  const {
    contacts,
    conversations,
    currentUser,
    currentUserError,
    ensureUsers,
    isReady,
    usersById,
  } = useClientData()
  const unreadOutsideCount = conversations.reduce(
    (total, item) =>
      item.id === conversationId || item.notificationMuted
        ? total
        : total + item.unreadCount,
    0
  )
  const listedConversation = conversations.find(
    (item) => item.id === conversationId
  )
  const expectsTopic =
    Boolean(parentConversationId) ||
    params.topic === "1" ||
    listedConversation?.type === "topic"
  const topicQuery = useConversationTopic(
    session,
    conversationId,
    expectsTopic
  )
  const cachedConversation =
    unlistedConversation?.id === conversationId
      ? unlistedConversation
      : undefined
  useEffect(() => {
    if (!isReady || listedConversation || expectsTopic) return
    if (!conversationId) {
      router.dismissTo("/messages")
      return
    }

    let active = true
    void conversationManager.get(session, conversationId).then(
      (storedConversation) => {
        if (!active) return
        if (storedConversation) {
          setUnlistedConversation(storedConversation)
          return
        }
        router.dismissTo("/messages")
      },
      () => {
        if (active) router.dismissTo("/messages")
      }
    )
    return () => {
      active = false
    }
  }, [
    conversationId,
    expectsTopic,
    isReady,
    listedConversation,
    router,
    session,
  ])
  const conversationSource =
    topicQuery.data?.conversation ?? listedConversation ?? cachedConversation
  const topicSourceMessage = topicQuery.data?.sourceMessage
  const conversationUserIds = useMemo(
    () =>
      conversationSource
        ? [
            ...(conversationSource.members ?? []).flatMap((member) =>
              member.type === "user" ? [member.id] : []
            ),
            ...(conversationSource.lastMessageSender?.type === "user"
              ? [conversationSource.lastMessageSender.id]
              : []),
            ...(conversationSource.topic?.sourceSender.type === "user"
              ? [conversationSource.topic.sourceSender.id]
              : []),
            ...(topicSourceMessage?.sender.type === "user"
              ? [topicSourceMessage.sender.id]
              : []),
          ]
        : [],
    [conversationSource, topicSourceMessage]
  )
  const conversationUserIdsKey = conversationUserIds.slice().sort().join("\u0000")
  useEffect(() => {
    const ids = conversationUserIdsKey ? conversationUserIdsKey.split("\u0000") : []
    if (ids.length > 0) void ensureUsers(ids).catch(() => undefined)
  }, [conversationUserIdsKey, ensureUsers])
  const conversation = useMemo(
    () =>
      conversationSource
        ? hydrateClientConversationUsers(
            conversationSource,
            contacts.apps,
            usersById
          )
        : undefined,
    [contacts.apps, conversationSource, usersById]
  )
  const isTopicConversation = expectsTopic || conversation?.type === "topic"
  const topicArchived = Boolean(conversation?.topic?.archived)
  const createTopicMutation = useCreateConversationTopic(
    session,
    conversationId
  )
  const mentionCandidates = useMemo(
    () =>
      conversation?.type === "group" ||
      conversation?.topic?.parentConversationType === "group"
        ? createMentionCandidates(conversation.members ?? [])
        : [],
    [conversation]
  )
  const messagesQuery = useConversationMessages(session, conversationId, {
    fallbackPollingEnabled: !realtimeReady,
  })
  useTargetMessageNavigation({
    fetchOlderMessages: messagesQuery.fetchOlder,
    hasOlder: messagesQuery.hasOlder,
    isFetchingOlder: messagesQuery.isFetchingOlder,
    isLoading: messagesQuery.isLoading,
    messages: messagesQuery.messages,
    targetMessageId,
  })
  const { mutateAsync: markRead } = useMarkConversationRead(
    session,
    conversationId
  )
  const messageResources = useMemo(
    () =>
      collectMessageResources([
        ...messagesQuery.messages,
        ...(topicSourceMessage ? [{ body: topicSourceMessage.body }] : []),
      ]),
    [messagesQuery.messages, topicSourceMessage]
  )
  const messageUserIds = useMemo(
    () => collectMessageUserIds(messagesQuery.messages),
    [messagesQuery.messages]
  )
  const messageUserIdsKey = messageUserIds.slice().sort().join("\u0000")
  useEffect(() => {
    const ids = messageUserIdsKey ? messageUserIdsKey.split("\u0000") : []
    if (ids.length > 0) void ensureUsers(ids).catch(() => undefined)
  }, [ensureUsers, messageUserIdsKey])
  const profileContacts = useMemo(
    () => ({ ...contacts, users: Object.values(usersById) }),
    [contacts, usersById]
  )
  const resources = useMessageResources(session, messageResources)
  const resolveMentionLabel = useMemo(
    () =>
      conversation && currentUser
        ? createMessageMentionLabelResolver({
            contacts: profileContacts,
            conversation,
            currentUser,
          })
        : EMPTY_MENTION_RESOLVER,
    [conversation, currentUser, profileContacts]
  )
  const messageActions = useConversationMessageActions({
    conversationId,
    confirmedMessages: messagesQuery.messages,
    forwardMessageId: forwardMessage?.id,
    onReplySent: (messageId) => {
      setReplyTarget((current) => current?.id === messageId ? null : current)
    },
    replyToMessageId: replyTarget?.id,
    server: session,
  })
  const displayedMessages = useMemo(
    () => mergeOptimisticMessages(messagesQuery.messages, messageActions.optimisticMessages),
    [messageActions.optimisticMessages, messagesQuery.messages]
  )
  const displayedResourceStates = useMemo(() => {
    const states = new Map(resources.states)
    for (const item of messageActions.optimisticMessages) {
      const descriptor = item.descriptor
      if (descriptor.kind === "text") continue
      states.set(descriptor.upload.uri, {
        error: null,
        resource: {
          identity: `optimistic:${descriptor.clientMessageId}`,
          mimeType: descriptor.upload.mimeType,
          sizeBytes: descriptor.upload.sizeBytes,
          source: "cache" as const,
          uri: descriptor.upload.uri,
        },
        status: "ready" as const,
      })
    }
    return states
  }, [messageActions.optimisticMessages, resources.states])
  const presentedMessages = useMemo(
    () =>
      conversation && currentUser
        ? buildPresentedMessages({
            contacts: profileContacts,
            conversation,
            currentUser,
            messages: displayedMessages,
            resolveMentionLabel,
          })
        : [],
    [
      conversation,
      currentUser,
      displayedMessages,
      profileContacts,
      resolveMentionLabel,
    ]
  )

  const presentedTopicSourceMessage = useMemo(
    () =>
      currentUser && topicSourceMessage
        ? buildPresentedTopicSourceMessage({
            contacts,
            currentUser,
            fallbackSender: conversation?.topic?.sourceSender,
            resolveMentionLabel,
            sourceMessage: topicSourceMessage,
          })
        : undefined,
    [
      contacts,
      conversation?.topic?.sourceSender,
      currentUser,
      resolveMentionLabel,
      topicSourceMessage,
    ]
  )

  const handleSelectionReply = useCallback(
    (target: ScopedMessageActionTarget) => {
      setReplyTarget(target)
      requestAnimationFrame(() => composerRef.current?.focus())
    },
    []
  )
  const handleSelectionForward = useCallback(
    (target: ScopedMessageActionTarget) => {
      setForwardMessage(target)
      composerRef.current?.dismissAccessory()
      requestAnimationFrame(() => setForwardSheetOpen(true))
    },
    []
  )
  const handleMessageLongPress = useCallback(
    (message: PresentedMessage) => {
      void triggerMessageActionHaptic()
      setMessageActionTarget({
        author: message.author,
        avatar: message.avatar,
        canCreateTopic: !isTopicConversation && !message.topic,
        canRevoke: message.canRevoke,
        conversationId,
        createdAt: message.createdAt,
        id: message.id,
        summary: formatClientMessageBodySummary(
          message.body,
          resolveMentionLabel
        ),
      })
      setMessageActionSheetOpen(true)
      composerRef.current?.dismissAccessory()
    },
    [conversationId, isTopicConversation, resolveMentionLabel]
  )
  const handleMessageRevoked = useCallback((messageId: string) => {
    setReplyTarget((current) =>
      current?.id === messageId ? null : current
    )
  }, [])
  const { goBack, openTopic } = useConversationNavigation({
    activateConversation,
    conversationId,
    isFocused,
    parentConversationId,
  })
  const handleCreateTopic = useCallback(
    async (target: ScopedMessageActionTarget) => {
      if (!target.canCreateTopic || createTopicMutation.isPending) return
      loadingToast.show({
        duration: 0,
        message: "正在创建话题",
        type: "loading",
      })
      try {
        const result = await createTopicMutation.mutateAsync(target.id)
        loadingToast.hide()
        openTopic(result.conversation.id)
      } catch (error: unknown) {
        loadingToast.hide()
        Alert.alert(
          "创建话题失败",
          error instanceof ApiRequestError ? error.message : "请稍后重试。"
        )
      }
    },
    [createTopicMutation, loadingToast, openTopic]
  )
  const messageSelectionActions = useMessageSelectionActions({
    canCreateTopic: !isTopicConversation,
    conversationId,
    isFocused,
    messages: presentedMessages,
    onCreateTopic: handleCreateTopic,
    onForward: handleSelectionForward,
    onReply: handleSelectionReply,
    onRevoked: handleMessageRevoked,
    resolveMentionLabel,
    server: session,
    topicArchived,
  })
  useEffect(() => {
    const error = messagesQuery.error ?? topicQuery.error ?? currentUserError
    if (isUnauthorizedError(error)) {
      void invalidateSession()
    }
  }, [
    currentUserError,
    invalidateSession,
    messagesQuery.error,
    topicQuery.error,
  ])

  useConversationReadSync({
    conversation,
    conversationId,
    isFocused,
    markRead,
    messages: messagesQuery.messages,
  })

  function handleRetryMessages() {
    void messagesQuery.refetch()
  }

  function handleLoadOlder() {
    if (!messagesQuery.hasOlder || messagesQuery.isFetchingOlder) return
    void messagesQuery.fetchOlder()
  }

  function handleAvatarPress(sender: EntityReference) {
    router.push(buildEntityDetailHref(sender))
  }

  function handleConversationDetails() {
    if (!conversation) return
    router.push(
      buildConversationDetailsHref(conversationId, parentConversationId || undefined)
    )
  }

  function handleAvatarLongPress(sender: EntityReference) {
    if (
      (conversation?.type !== "group" &&
        conversation?.topic?.parentConversationType !== "group") ||
      sender.type === "group"
    ) {
      return
    }

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

  function handleImagePress(fileId: string, messageId: string) {
    router.push(
      buildAttachmentImagePreviewHref(fileId, { conversationId, messageId })
    )
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

  const conversationTitle = conversation
    ? conversation.type === "group"
      ? `${conversation.name}(${conversation.memberCount || conversation.members?.length || 0})`
      : conversation.name
    : "对话"
  const headerAction = conversation ? handleConversationDetails : undefined

  return (
    <YStack bg={colors.background0} flex={1}>
      <AppHeader
        actions={
          headerAction
            ? [
                {
                  icon: IconDots,
                  iconColor: colors.textPrimary,
                  label: "查看对话详情",
                  onPress: headerAction,
                  strokeWidth: 2,
                },
              ]
            : []
        }
        backAccessory={
          unreadOutsideCount > 0 ? (
            <XGUIBadge
              accessibilityLabel={`${unreadOutsideCount} 条其他未读消息`}
              backgroundColor={colors.foreground4}
              count={unreadOutsideCount}
              size="large"
              textColor={colors.foreground0Half}
            />
          ) : undefined
        }
        onBackPress={goBack}
        title={conversationTitle}
      />

      <YStack bg={colors.background1} flex={1} pb={insets.bottom}>
        <KeyboardAwareScreen
          contentBackground={colors.background0}
          edges={[]}
          keyboardVerticalOffset={insets.top + APP_HEADER_HEIGHT}
          scrollable={false}
        >
          {!conversation ? (
            <ContentState
              loading={!isReady || !expectsTopic || topicQuery.isLoading}
              message={
                expectsTopic
                  ? topicQuery.error?.message ?? "正在加载话题"
                  : "正在打开会话"
              }
              tone={topicQuery.error ? "error" : undefined}
            />
          ) : expectsTopic && !topicQuery.data ? (
            <ContentState
              loading={topicQuery.isLoading}
              message={topicQuery.error?.message ?? "正在加载话题"}
              tone={topicQuery.error ? "error" : undefined}
            />
          ) : !currentUser ? (
            <ContentState loading message="正在加载用户信息" />
          ) : (
            <>
              <MessageList
              canAddReaction={!topicArchived}
              canCreateTopic={!isTopicConversation}
              canRespondToChoice={conversation.canSend && !topicArchived}
              conversationId={conversation.id}
              currentUserId={currentUser.id}
              error={messagesQuery.error}
              hasOlder={messagesQuery.hasOlder}
              isFetchingOlder={messagesQuery.isFetchingOlder}
              initialMessageId={targetMessageId || undefined}
              isLoading={messagesQuery.isLoading}
              messages={presentedMessages}
              optimisticMessages={messageActions.optimisticMessages}
              onRetryMessage={messageActions.retryMessage}
              onAvatarLongPress={
                conversation.type === "group"
                  ? handleAvatarLongPress
                  : undefined
              }
              onAvatarPress={handleAvatarPress}
              onContentTouch={() => {
                composerRef.current?.dismissAccessory()
                Keyboard.dismiss()
              }}
              onImagePress={handleImagePress}
              onLoadOlder={handleLoadOlder}
              onMessageLongPress={handleMessageLongPress}
              onRetry={handleRetryMessages}
              onResourceError={(fileId) =>
                void resources.reload(fileId).catch(() => undefined)
              }
              onResourcePress={(fileId) => void handleResourcePress(fileId)}
              onRespondChoice={messageActions.respondChoice}
              onSetReaction={messageActions.setReaction}
              onVoiceResourcePress={(fileId) =>
                void handleVoiceResourcePress(fileId)
              }
              onMentionPress={handleAvatarPress}
              onOpenTopic={openTopic}
              resolveMentionLabel={resolveMentionLabel}
              resourceStates={displayedResourceStates}
              server={session}
              showChoiceResponseCounts={
                shouldShowMessageChoiceResponseCounts(conversation)
              }
              topicSourceMessage={presentedTopicSourceMessage}
              />
              {topicArchived ? (
                <YStack bg={colors.background1} items="center" p="$4">
                  <SizableText color={colors.textPlaceholder} size="$3">
                    话题已关闭，无法继续发言
                  </SizableText>
                </YStack>
              ) : (
                <MessageComposer
                  disabled={!conversation.canSend}
                  mentionCandidates={mentionCandidates}
                  onClearReply={() => setReplyTarget(null)}
                  onSend={messageActions.sendText}
                  onSendUpload={messageActions.sendUpload}
                  onSendVoice={messageActions.sendVoice}
                  ref={composerRef}
                  replyTarget={replyTarget}
                  server={session}
                  sending={messageActions.isSending}
                />
              )}
            </>
          )}
        </KeyboardAwareScreen>
      </YStack>

      {messageActionTarget ? (
        <XGUIActionSheet
          actions={[
            ...(messageActionTarget.canCreateTopic
              ? [
                  {
                    deferUntilClosed: false,
                    disabled: createTopicMutation.isPending,
                    label: "创建话题",
                    onPress: () => void handleCreateTopic(messageActionTarget),
                  },
                ]
              : []),
            ...(!topicArchived
              ? [
                  {
                    deferUntilClosed: false,
                    label: "回复",
                    onPress: () => handleSelectionReply(messageActionTarget),
                  },
                ]
              : []),
            {
              deferUntilClosed: true,
              label: "转发",
              onPress: () => handleSelectionForward(messageActionTarget),
            },
            ...(messageActionTarget.canRevoke
              ? [
                  {
                    deferUntilClosed: false,
                    destructive: true,
                    disabled: messageSelectionActions.revoking,
                    label: "撤回",
                    onPress: () =>
                      void messageSelectionActions.revoke(
                        messageActionTarget.id
                      ),
                  },
                ]
              : []),
          ]}
          description={messageActionTarget.summary}
          descriptionNumberOfLines={2}
          onAnimationComplete={(open) => {
            if (!open) setMessageActionTarget(null)
          }}
          onOpenChange={setMessageActionSheetOpen}
          open={messageActionSheetOpen}
          title="消息操作"
        />
      ) : null}
      {forwardMessage ? (
        <ForwardMessageSheet
          conversations={conversations}
          onAnimationComplete={(open) => {
            if (!open) setForwardMessage(null)
          }}
          onForward={messageActions.forward}
          onRequestClose={requestForwardSheetClose}
          open={forwardSheetOpen}
          server={session}
          source={forwardMessage}
        />
      ) : null}
    </YStack>
  )
}

async function triggerMessageActionHaptic() {
  try {
    if (Platform.OS === "android") {
      await Haptics.performAndroidHapticsAsync(
        Haptics.AndroidHaptics.Long_Press
      )
      return
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  } catch {
    // Haptics must not prevent the message action sheet from opening.
  }
}
