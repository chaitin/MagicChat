// Tabler exposes per-icon runtime entry points without per-icon declarations.
// eslint-disable-next-line import/no-unresolved
import IconAlertCircleFilled from "@tabler/icons-react-native/IconAlertCircleFilled"
import { memo, useRef } from "react"
import { Pressable, View } from "react-native"
import {
  Button,
  Paragraph,
  SizableText,
  XStack,
  YStack,
} from "tamagui"

import { AppAvatar } from "@/components/avatar/app-avatar"
import type { EntityReference } from "@/domain/entities/entity-profile"
import type { ServerTarget } from "@/core/server-target"
import type { ResourceLoadState } from "@/data/resources"
import { MessageBody } from "@/features/conversation/messages/message-body"
import { MessageChoice } from "@/features/conversation/messages/message-choice"
import { MessageReactionChips } from "@/features/conversation/messages/message-reactions"
import { TopicReplyPreview } from "@/features/conversation/topic/topic-reply-preview"
import {
  formatClientMessageBodySummary,
  type MessageMentionLabelResolver,
  type PresentedMessage,
} from "@/domain/messages/message-presenter"
import { XGUILoadingIcon, useXGUITheme } from "@/xgui"

export const MessageBubble = memo(function MessageBubble({
  currentUserId,
  highlighted = false,
  message,
  messageActionsEnabled = true,
  canAddReaction,
  canCreateTopic,
  canRespondToChoice,
  onAvatarLongPress,
  onAvatarPress,
  onImagePress,
  onMentionPress,
  onMessageLongPress,
  onOpenTopic,
  onResourceError,
  onRetryMessage,
  optimisticClientMessageId,
  optimisticStatus,
  onResourcePress,
  onRespondChoice,
  onSetReaction,
  onVoiceResourcePress,
  resolveMentionLabel,
  resourceStates,
  server,
  showChoiceResponseCounts,
}: {
  canAddReaction: boolean
  canCreateTopic: boolean
  canRespondToChoice: boolean
  currentUserId: string
  highlighted?: boolean
  message: PresentedMessage
  messageActionsEnabled?: boolean
  onAvatarLongPress?: (sender: EntityReference) => void
  onAvatarPress: (sender: EntityReference) => void
  onImagePress: (fileId: string, messageId: string) => void
  onMentionPress: (target: EntityReference) => void
  onMessageLongPress: (message: PresentedMessage) => void
  onOpenTopic: (conversationId: string) => void
  onRetryMessage?: (clientMessageId: string) => void
  optimisticClientMessageId?: string
  optimisticStatus?: "sending" | "failed"
  onResourceError: (fileId: string) => void
  onResourcePress: (fileId: string) => void
  onRespondChoice?: (messageId: string, optionIds: string[]) => Promise<void>
  onSetReaction?: (
    messageId: string,
    text: string,
    reacted: boolean
  ) => Promise<void>
  onVoiceResourcePress: (fileId: string) => void
  resolveMentionLabel: MessageMentionLabelResolver
  resourceStates: ReadonlyMap<string, ResourceLoadState>
  server: ServerTarget
  showChoiceResponseCounts: boolean
}) {
  const { colors } = useXGUITheme()
  const didLongPressAvatarRef = useRef(false)

  if (message.role === "system") {
    return (
      <XStack bg={highlighted ? colors.brand1 : undefined} justify="center" px="$5">
        <XStack maxW="85%">
          <SizableText color={colors.textPlaceholder} size="$2" text="center">
            {formatClientMessageBodySummary(message.body, resolveMentionLabel)}
          </SizableText>
        </XStack>
      </XStack>
    )
  }

  const fromMe = message.role === "me"
  const allowsTextSelection =
    message.body.type === "text" || message.body.type === "markdown"
  const allowsTopicCreation = canCreateTopic && !message.topic
  const messageSelectionNativeId =
    allowsTextSelection && messageActionsEnabled
      ? `magicchat-message:${message.canRevoke ? "1" : "0"}:${allowsTopicCreation ? "1" : "0"}:${message.id}`
      : undefined
  const sender = message.sender
  const flushImageBubble =
    (message.body.type === "image" || message.body.type === "video") &&
    !message.replyTo &&
    !message.topic
  const videoHasFollowingContent =
    message.body.type === "video" &&
    (Boolean(message.body.caption) ||
      message.reactions.length > 0 ||
      Boolean(message.topic))
  const roundVideoBottom = !videoHasFollowingContent
  const usesStructuredBubbleWidth =
    Boolean(message.topic) ||
    message.body.type === "voice" ||
    message.body.type === "video" ||
    message.body.type === "file" ||
    message.body.type === "chart" ||
    message.body.type === "forward_bundle" ||
    message.body.type === "link" ||
    message.body.type === "card" ||
    message.body.type === "choice"
  const structuredBubbleWidth =
    message.body.type === "chart"
      ? "82%"
      : usesStructuredBubbleWidth
        ? "66%"
        : undefined
  const avatar = sender ? (
    <Button
      aria-label={`查看${fromMe ? "我的" : message.author}资料`}
      chromeless
      height="$3"
      onLongPress={
        onAvatarLongPress
          ? () => {
              didLongPressAvatarRef.current = true
              onAvatarLongPress(sender)
            }
          : undefined
      }
      onPress={() => {
        if (didLongPressAvatarRef.current) {
          didLongPressAvatarRef.current = false
          return
        }
        onAvatarPress(sender)
      }}
      onPressIn={() => {
        didLongPressAvatarRef.current = false
      }}
      p={0}
      width="$3"
    >
      <MessageAvatar
        avatar={message.avatar}
        name={fromMe ? "我" : message.author}
        server={server}
        type={message.sender?.type === "app" ? "app" : "user"}
      />
    </Button>
  ) : (
    <MessageAvatar
      avatar={message.avatar}
      name={fromMe ? "我" : message.author}
      server={server}
      type={message.sender?.type === "app" ? "app" : "user"}
    />
  )

  return (
    <XStack
      bg={highlighted ? colors.brand1 : undefined}
      gap="$2"
      items="flex-start"
      justify={fromMe ? "flex-end" : "flex-start"}
      px="$3"
    >
      {!fromMe ? avatar : null}
      <YStack
        gap="$1"
        items={fromMe ? "flex-end" : "flex-start"}
        maxW="82%"
        width={structuredBubbleWidth}
      >
        <XStack gap="$2" items="center">
          <SizableText
            color={colors.textSecondary}
            numberOfLines={1}
            size="$2"
          >
            {message.author}
          </SizableText>
        </XStack>

        <View
          collapsable={false}
          nativeID={messageSelectionNativeId}
          style={{
            maxWidth: "100%",
            position: "relative",
            width: structuredBubbleWidth ? "100%" : undefined,
          }}
        >
          {fromMe && optimisticStatus ? (
            <View
              style={{
                left: -28,
                position: "absolute",
                top: "50%",
                transform: [{ translateY: -10 }],
              }}
            >
              {optimisticStatus === "sending" ? (
                <View
                  accessibilityLabel="消息发送中"
                  accessibilityRole="progressbar"
                >
                  <XGUILoadingIcon color={colors.textPlaceholder} size={20} />
                </View>
              ) : (
                <Pressable
                  accessibilityLabel="重新发送消息"
                  accessibilityRole="button"
                  disabled={!onRetryMessage || !optimisticClientMessageId}
                  hitSlop={8}
                  onPress={() => {
                    if (optimisticClientMessageId) {
                      onRetryMessage?.(optimisticClientMessageId)
                    }
                  }}
                >
                  <IconAlertCircleFilled
                    color={colors.destructive}
                    size={20}
                  />
                </Pressable>
              )}
            </View>
          ) : null}
          <YStack
            bg={
              fromMe
                ? colors.brand1
                : colors.background2
            }
            rounded="$5"
            borderTopLeftRadius={fromMe ? "$5" : "$1"}
            borderTopRightRadius={fromMe ? "$1" : "$5"}
            borderWidth={0}
            maxW="100%"
            overflow="hidden"
            p={flushImageBubble ? 0 : "$3"}
            width={structuredBubbleWidth ? "100%" : undefined}
          >
            {message.replyTo ? (
              <YStack
                borderColor="$borderColor"
                borderLeftWidth={2}
                mb="$2"
                pl="$2"
              >
                <SizableText
                  color={colors.textSecondary}
                  fontWeight="700"
                  numberOfLines={1}
                  selectable={allowsTextSelection}
                  size="$3"
                >
                  {message.replyTo.author}
                </SizableText>
                <Paragraph
                  color={colors.textSecondary}
                  numberOfLines={2}
                  selectable={allowsTextSelection}
                  size="$3"
                >
                  {message.replyTo.summary}
                </Paragraph>
              </YStack>
            ) : null}
            {message.body.type === "choice" ? (
              <MessageChoice
                body={message.body}
                canRespond={canRespondToChoice}
                choice={message.choice}
                currentUserId={currentUserId}
                onLongPress={() => onMessageLongPress(message)}
                onMentionPress={onMentionPress}
                onRespond={
                  onRespondChoice
                    ? (optionIds) => onRespondChoice(message.id, optionIds)
                    : undefined
                }
                resolveMentionLabel={resolveMentionLabel}
                serverUrl={server.url}
                showResponseCounts={showChoiceResponseCounts}
              />
            ) : (
              <MessageBody
                body={message.body}
                bubbleTone={fromMe ? "mine" : "other"}
                currentUserId={currentUserId}
                flushImage={flushImageBubble}
                onImagePress={(fileId) => onImagePress(fileId, message.id)}
                onMentionPress={onMentionPress}
                onMessageLongPress={() => onMessageLongPress(message)}
                onResourceError={onResourceError}
                onResourcePress={onResourcePress}
                onVoiceResourcePress={onVoiceResourcePress}
                resolveMentionLabel={resolveMentionLabel}
                resourceStates={resourceStates}
                roundVideoBottom={roundVideoBottom}
                serverUrl={server.url}
              />
            )}
            {message.reactions.length > 0 ? (
              <YStack
                mb={flushImageBubble ? "$2" : undefined}
                mt="$2"
                px={flushImageBubble ? "$2" : undefined}
              >
                <MessageReactionChips
                  align={fromMe ? "end" : "start"}
                  canAdd={
                    canAddReaction && message.body.type !== "revoked"
                  }
                  onSetReaction={
                    onSetReaction && message.body.type !== "revoked"
                      ? (text, reacted) =>
                          onSetReaction(message.id, text, reacted)
                      : undefined
                  }
                  onUserPress={(user) =>
                    onAvatarPress({ id: user.id, type: "user" })
                  }
                  reactions={message.reactions}
                />
              </YStack>
            ) : null}
            {message.topic ? (
              <TopicReplyPreview
                onOpen={() => onOpenTopic(message.topic!.conversationId)}
                server={server}
                topic={message.topic}
              />
            ) : null}
          </YStack>
        </View>

        {message.delegatedByName ? (
          <SizableText color={colors.textPlaceholder} size="$1">
            由 {message.delegatedByName} 代发
          </SizableText>
        ) : null}
      </YStack>
      {fromMe ? avatar : null}
    </XStack>
  )
})

function MessageAvatar({
  avatar,
  name,
  server,
  type,
}: {
  avatar: string
  name: string
  server: ServerTarget
  type: "app" | "user"
}) {
  return <AppAvatar accessibilityLabel={name} avatar={avatar} server={server} size="$3" type={type} />
}
