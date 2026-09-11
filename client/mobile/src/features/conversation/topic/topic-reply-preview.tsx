import { MessagesSquare } from "lucide-react-native"
import { Pressable } from "react-native"
import { Separator, SizableText, XStack, YStack } from "tamagui"

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
        <YStack mt="$3" opacity={pressed ? 0.72 : 1} width="100%">
          <Separator borderColor={colors.separator} mb="$2" />

          {topic.recentReplies.length > 0 ? (
            <>
              <YStack gap="$2">
                {topic.recentReplies.map((reply) => (
                  <XStack gap="$2" items="center" key={reply.id} minW={0}>
                    <TopicReplyAvatar
                      avatar={reply.avatar}
                      name={reply.author}
                      server={server}
                    />
                    <SizableText flex={1} minW={0} numberOfLines={1} size="$3">
                      <SizableText
                        color={colors.textPrimary}
                        fontWeight="600"
                        size="$3"
                      >
                        {reply.author}
                      </SizableText>
                      <SizableText color={colors.textSecondary} size="$3">
                        ：{reply.summary}
                      </SizableText>
                    </SizableText>
                  </XStack>
                ))}
              </YStack>
              <Separator borderColor={colors.separator} my="$3" />
            </>
          ) : null}

          <XStack gap="$3" items="center" justify="space-between">
            <XStack gap="$2" items="center">
              <ThemedIcon color={colors.link} icon={MessagesSquare} size={16} />
              <SizableText color={colors.link} fontWeight="600" size="$3">
                查看话题
              </SizableText>
            </XStack>
            {latestReplyTime ? (
              <SizableText color={colors.textSecondary} size="$3">
                {latestReplyTime}
              </SizableText>
            ) : null}
          </XStack>
        </YStack>
      )}
    </Pressable>
  )
}

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
