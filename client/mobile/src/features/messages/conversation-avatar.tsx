import { StyleSheet, View } from "react-native"

import { AppAvatar } from "@/components/avatar/app-avatar"
import type { ClientConversation } from "@/core/models"
import type { ServerTarget } from "@/core/server-target"
import { getConversationAvatarName, getConversationAvatarType, type ConversationAvatarType } from "@/domain/conversations/conversation-avatar"
import { XGUIBadge, useXGUITheme } from "@/xgui"

export function ConversationAvatar({ conversation, server, surroundingBackground, topicSourceOnly = false }: { conversation: ClientConversation; server: ServerTarget; surroundingBackground?: string; topicSourceOnly?: boolean }) {
  const { colors } = useXGUITheme()
  const avatarName = getConversationAvatarName(conversation)
  const avatarType = getConversationAvatarType(conversation)
  const sourceSender = conversation.type === "topic" ? conversation.topic?.sourceSender : undefined
  const usesTopicSourceAvatar = Boolean(topicSourceOnly && sourceSender)
  const size = topicSourceOnly ? 28 : 44

  return (
    <View style={{ height: size, width: size }}>
      {usesTopicSourceAvatar && sourceSender ? (
        <TopicSourceAvatar server={server} sourceSender={sourceSender} />
      ) : (
        <BaseConversationAvatar avatarName={avatarName} avatarType={avatarType} compact={topicSourceOnly} conversation={conversation} server={server} />
      )}
      {sourceSender && !usesTopicSourceAvatar ? (
        <View accessible accessibilityLabel={`话题来源：${sourceSender.name}`} style={[styles.topicSource, { backgroundColor: surroundingBackground ?? colors.background2 }]}>
          <AppAvatar avatar={sourceSender.avatar} rounded server={server} size={18} type={sourceSender.type === "app" ? "app" : "user"} />
        </View>
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
    </View>
  )
}

function TopicSourceAvatar({ server, sourceSender }: { server: ServerTarget; sourceSender: NonNullable<ClientConversation["topic"]>["sourceSender"] }) {
  return <AppAvatar accessibilityLabel={`话题来源：${sourceSender.name}`} avatar={sourceSender.avatar} rounded server={server} size={28} type={sourceSender.type === "app" ? "app" : "user"} />
}

function BaseConversationAvatar({ avatarName, avatarType, compact, conversation, server }: { avatarName: string; avatarType: ConversationAvatarType; compact: boolean; conversation: ClientConversation; server: ServerTarget }) {
  const type = avatarType === "group" ? "group" : avatarType === "app" ? "app" : "user"
  return <AppAvatar accessibilityLabel={avatarName} avatar={conversation.avatar} members={avatarType === "group" ? conversation.members : []} rounded={compact} server={server} size={compact ? 28 : 44} type={type} />
}

const styles = StyleSheet.create({
  topicSource: { borderRadius: 34, bottom: -4, padding: 1, position: "absolute", right: -4, zIndex: 1 },
  unreadBadge: { position: "absolute", right: -7, top: -7, zIndex: 1 },
  unreadDot: { right: -4, top: -4 },
})
