// Tabler exposes per-icon runtime entry points without per-icon declarations.
// eslint-disable-next-line import/no-unresolved
import IconAlertCircleFilled from "@tabler/icons-react-native/IconAlertCircleFilled"
import { memo, useRef } from "react"
import { Pressable, View } from "react-native"
import { Text } from "@/components/mi-sans-text"

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
  avatarType,
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
  avatarType?: "app" | "user"
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
      <View style={{ alignItems: "center", backgroundColor: highlighted ? colors.brand1 : undefined, paddingHorizontal: 24 }}>
        <View style={{ maxWidth: "85%" }}>
          <Text style={{ color: colors.textPlaceholder, fontSize: 13, lineHeight: 20, textAlign: "center" }}>
            {formatClientMessageBodySummary(message.body, resolveMentionLabel)}
          </Text>
        </View>
      </View>
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
    <Pressable
      accessibilityLabel={`查看${fromMe ? "我的" : message.author}资料`}
      accessibilityRole="button"
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
      style={{ height: 36, width: 36 }}
    >
      <MessageAvatar
        avatar={message.avatar}
        name={fromMe ? "我" : message.author}
        server={server}
        type={avatarType ?? (message.sender?.type === "app" ? "app" : "user")}
      />
    </Pressable>
  ) : (
    <MessageAvatar
      avatar={message.avatar}
      name={fromMe ? "我" : message.author}
      server={server}
      type={avatarType ?? (message.sender?.type === "app" ? "app" : "user")}
    />
  )

  return (
    <View style={{ alignItems: "flex-start", backgroundColor: highlighted ? colors.brand1 : undefined, flexDirection: "row", gap: 7, justifyContent: fromMe ? "flex-end" : "flex-start", paddingHorizontal: 13 }}>
      {!fromMe ? avatar : null}
      <View style={{ alignItems: fromMe ? "flex-end" : "flex-start", gap: 2, maxWidth: "82%", width: structuredBubbleWidth }}>
        <View style={{ alignItems: "center", flexDirection: "row", gap: 7 }}>
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
            {message.author}
          </Text>
        </View>

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
          <View style={{ backgroundColor: fromMe ? colors.brand1 : colors.background2, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, borderTopLeftRadius: fromMe ? 10 : 3, borderTopRightRadius: fromMe ? 3 : 10, maxWidth: "100%", overflow: "hidden", padding: flushImageBubble ? 0 : 13, width: structuredBubbleWidth ? "100%" : undefined }}>
            {message.replyTo ? (
              <View style={{ borderColor: colors.separator, borderLeftWidth: 2, marginBottom: 7, paddingLeft: 7 }}>
                <Text numberOfLines={1} selectable={allowsTextSelection} style={{ color: colors.textSecondary, fontSize: 14, fontWeight: "600", lineHeight: 21 }}>
                  {message.replyTo.author}
                </Text>
                <Text numberOfLines={2} selectable={allowsTextSelection} style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
                  {message.replyTo.summary}
                </Text>
              </View>
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
              <View style={{ marginBottom: flushImageBubble ? 7 : undefined, marginTop: 7, paddingHorizontal: flushImageBubble ? 7 : undefined }}>
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
                    onAvatarPress({ id: user.id, type: user.type ?? "user" })
                  }
                  reactions={message.reactions}
                />
              </View>
            ) : null}
            {message.topic ? (
              <TopicReplyPreview
                onOpen={() => onOpenTopic(message.topic!.conversationId)}
                server={server}
                topic={message.topic}
              />
            ) : null}
          </View>
        </View>

        {message.delegatedByName ? (
          <Text style={{ color: colors.textPlaceholder, fontSize: 12, lineHeight: 18 }}>
            由 {message.delegatedByName} 代发
          </Text>
        ) : null}
      </View>
      {fromMe ? avatar : null}
    </View>
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
