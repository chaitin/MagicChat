import { StyleSheet, View } from "react-native"

import { AppAvatar } from "@/components/avatar/app-avatar"
import type { ClientConversation } from "@/core/models"
import type { ServerTarget } from "@/core/server-target"
import { getConversationAvatarName, getConversationAvatarType, type ConversationAvatarType } from "@/domain/conversations/conversation-avatar"
import { XGUIBadge, useXGUITheme } from "@/xgui"

export function ConversationAvatar({ conversation, server, surroundingBackground, compact = false }: { conversation: ClientConversation; server: ServerTarget; surroundingBackground?: string; compact?: boolean }) {
  const { colors } = useXGUITheme()
  const avatarName = getConversationAvatarName(conversation)
  const avatarType = getConversationAvatarType(conversation)
  const sourceSender = conversation.type === "topic" ? conversation.topic?.sourceSender : undefined
  const size = compact ? 28 : 44

  return (
    <View style={{ alignItems: "center", height: size, justifyContent: "center", width: size }}>
      <BaseConversationAvatar avatarName={avatarName} avatarType={avatarType} compact={compact} conversation={conversation} server={server} />
      {sourceSender ? (
        <View accessible accessibilityLabel={`话题来源：${sourceSender.name}`} style={[styles.topicSource, compact && styles.compactTopicSource, { backgroundColor: surroundingBackground ?? colors.background2 }]}>
          <AppAvatar avatar={sourceSender.avatar} rounded server={server} size={compact ? 12 : 18} type={sourceSender.type === "app" ? "app" : "user"} />
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

function BaseConversationAvatar({ avatarName, avatarType, compact, conversation, server }: { avatarName: string; avatarType: ConversationAvatarType; compact: boolean; conversation: ClientConversation; server: ServerTarget }) {
  const type = avatarType === "group" ? "group" : avatarType === "app" ? "app" : "user"
  return <AppAvatar accessibilityLabel={avatarName} avatar={conversation.avatar} members={avatarType === "group" ? conversation.members : []} server={server} size={compact ? 24 : 44} type={type} />
}

const styles = StyleSheet.create({
  topicSource: { borderRadius: 34, bottom: -4, padding: 1, position: "absolute", right: -4, zIndex: 1 },
  compactTopicSource: { padding: 2 },
  unreadBadge: { position: "absolute", right: -7, top: -7, zIndex: 1 },
  unreadDot: { right: -4, top: -4 },
})
