import { StyleSheet } from "react-native"
import { type ColorTokens, YStack } from "tamagui"

import { AppAvatar } from "@/components/avatar/app-avatar"
import type { ClientConversation } from "@/core/models"
import type { ServerTarget } from "@/core/server-target"
import { getConversationAvatarName, getConversationAvatarType, type ConversationAvatarType } from "@/domain/conversations/conversation-avatar"
import { XGUIBadge } from "@/xgui"

export function ConversationAvatar({ conversation, server, surroundingBackground = "$color1", topicSourceOnly = false }: { conversation: ClientConversation; server: ServerTarget; surroundingBackground?: ColorTokens; topicSourceOnly?: boolean }) {
  const avatarName = getConversationAvatarName(conversation)
  const avatarType = getConversationAvatarType(conversation)
  const sourceSender = conversation.type === "topic" ? conversation.topic?.sourceSender : undefined
  const usesTopicSourceAvatar = Boolean(topicSourceOnly && sourceSender)
  const size = topicSourceOnly ? 28 : "$4"

  return (
    <YStack height={size} width={size}>
      {usesTopicSourceAvatar && sourceSender ? (
        <TopicSourceAvatar server={server} sourceSender={sourceSender} />
      ) : (
        <BaseConversationAvatar avatarName={avatarName} avatarType={avatarType} compact={topicSourceOnly} conversation={conversation} server={server} />
      )}
      {sourceSender && !usesTopicSourceAvatar ? (
        <YStack accessibilityLabel={`话题来源：${sourceSender.name}`} b={-4} bg={surroundingBackground} p={1} position="absolute" r={-4} rounded="$10" z={1}>
          <AppAvatar avatar={sourceSender.avatar} rounded server={server} size={18} type={sourceSender.type === "app" ? "app" : "user"} />
        </YStack>
      ) : null}
      {conversation.unreadCount > 0 ? (
        <XGUIBadge
          accessibilityLabel={
            conversation.notificationMuted
              ? "有未读消息"
              : `${conversation.unreadCount} 条未读消息`
          }
          count={conversation.unreadCount}
          dot={conversation.notificationMuted}
          style={[
            styles.unreadBadge,
            conversation.notificationMuted ? styles.unreadDot : null,
          ]}
        />
      ) : null}
    </YStack>
  )
}

function TopicSourceAvatar({ server, sourceSender }: { server: ServerTarget; sourceSender: NonNullable<ClientConversation["topic"]>["sourceSender"] }) {
  return <AppAvatar accessibilityLabel={`话题来源：${sourceSender.name}`} avatar={sourceSender.avatar} rounded server={server} size={28} type={sourceSender.type === "app" ? "app" : "user"} />
}

function BaseConversationAvatar({ avatarName, avatarType, compact, conversation, server }: { avatarName: string; avatarType: ConversationAvatarType; compact: boolean; conversation: ClientConversation; server: ServerTarget }) {
  const type = avatarType === "group" ? "group" : avatarType === "app" ? "app" : "user"
  return <AppAvatar accessibilityLabel={avatarName} avatar={conversation.avatar} members={avatarType === "group" ? conversation.members : []} rounded={compact} server={server} size={compact ? 28 : "$4"} type={type} />
}

const styles = StyleSheet.create({
  unreadBadge: { position: "absolute", right: -7, top: -7, zIndex: 1 },
  unreadDot: { right: -4, top: -4 },
})
