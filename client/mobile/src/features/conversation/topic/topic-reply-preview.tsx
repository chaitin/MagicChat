import { MessagesSquare } from "lucide-react-native"
import { Pressable, StyleSheet, View } from "react-native"

import { Text } from "@/components/mi-sans-text"

import { AppAvatar } from "@/components/avatar/app-avatar"
import { ThemedIcon } from "@/components/icons/themed-icon"
import type { ServerTarget } from "@/core/server-target"
import type { PresentedMessage } from "@/domain/messages/message-presenter"
import { useXGUITheme } from "@/xgui"

export function TopicReplyPreview({
  onOpen,
  server,
  topic,
}: {
  onOpen: () => void
  server: ServerTarget
  topic: NonNullable<PresentedMessage["topic"]>
}) {
  const { colors } = useXGUITheme()
  const latestReplyTime = topic.recentReplies.at(-1)?.time ?? ""

  return (
    <Pressable
      accessibilityLabel="查看话题"
      accessibilityRole="button"
      onPress={onOpen}
    >
      {({ pressed }) => (
        <View style={[styles.container, { opacity: pressed ? 0.72 : 1 }]}>
          <View style={[styles.separator, styles.topSeparator, { backgroundColor: colors.separator }]} />

          {topic.recentReplies.length > 0 ? (
            <>
              <View style={styles.replies}>
                {topic.recentReplies.map((reply) => (
                  <View key={reply.id} style={styles.reply}>
                    <TopicReplyAvatar
                      avatar={reply.avatar}
                      name={reply.author}
                      server={server}
                    />
                    <Text numberOfLines={1} style={styles.replyText}>
                      <Text style={{ color: colors.textPrimary }}>
                        {reply.author}
                      </Text>
                      <Text style={{ color: colors.textSecondary }}>
                        ：{reply.summary}
                      </Text>
                    </Text>
                  </View>
                ))}
              </View>
              <View style={[styles.separator, styles.middleSeparator, { backgroundColor: colors.separator }]} />
            </>
          ) : null}

          <View style={styles.footer}>
            <View style={styles.link}>
              <ThemedIcon color={colors.link} icon={MessagesSquare} size={16} />
              <Text style={[styles.footerText, { color: colors.link, fontWeight: "600" }]}>
                查看话题
              </Text>
            </View>
            {latestReplyTime ? (
              <Text style={[styles.footerText, { color: colors.textSecondary }]}>
                {latestReplyTime}
              </Text>
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: { marginTop: 13, width: "100%" },
  separator: { height: StyleSheet.hairlineWidth, width: "100%" },
  topSeparator: { marginBottom: 7 },
  middleSeparator: { marginVertical: 13 },
  replies: { gap: 7 },
  reply: { alignItems: "center", flexDirection: "row", gap: 7, minWidth: 0 },
  replyText: { flex: 1, fontSize: 14, lineHeight: 21, minWidth: 0 },
  footer: { alignItems: "center", flexDirection: "row", gap: 13, justifyContent: "space-between" },
  link: { alignItems: "center", flexDirection: "row", gap: 7 },
  footerText: { fontSize: 14, lineHeight: 21 },
})

function TopicReplyAvatar({
  avatar,
  name,
  server,
}: {
  avatar: string
  name: string
  server: ServerTarget
}) {
  return <AppAvatar accessibilityLabel={name} avatar={avatar} server={server} size={20} type="user" />
}
