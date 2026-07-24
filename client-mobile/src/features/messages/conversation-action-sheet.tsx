import { QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { BlurView } from "expo-blur"
import {
  Bell,
  BellOff,
  Pin,
  PinOff,
  Trash2,
  type LucideIcon,
} from "lucide-react-native"
import { Pressable, StyleSheet } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  ListItem,
  Separator,
  Sheet,
  SizableText,
  Spinner,
  useTheme,
  useThemeName,
  XStack,
  YStack,
} from "tamagui"

import { ListItemContent } from "@/components/lists/list-item-content"
import { useSheetBackHandler } from "@/components/overlays/use-sheet-back-handler"
import type { ServerTarget } from "@/data/query"
import { isBuiltinAssistantConversation } from "@/domain/conversations/conversation-order"
import { ConversationAvatar } from "@/features/messages/conversation-avatar"
import type { ConversationListItemModel } from "@/features/messages/conversation-list-model"
import { ConversationPreferenceIndicators } from "@/features/messages/conversation-preference-indicators"
import { useAppBlurTarget } from "@/providers/app-blur-target"

export type ConversationAction = "mute" | "pin" | null

export function ConversationActionSheet({
  activeAction,
  item,
  onAnimationComplete,
  onDelete,
  onMutedChange,
  onOpenChange,
  onPinnedChange,
  open,
  server,
}: {
  activeAction: ConversationAction
  item: ConversationListItemModel | null
  onAnimationComplete: (open: boolean) => void
  onDelete: () => void
  onMutedChange: (muted: boolean) => void
  onOpenChange: (open: boolean) => void
  onPinnedChange: (pinned: boolean) => void
  open: boolean
  server: ServerTarget
}) {
  const queryClient = useQueryClient()
  const blurTarget = useAppBlurTarget()
  const insets = useSafeAreaInsets()
  const themeName = useThemeName()
  const conversation = item?.conversation
  const busy = activeAction !== null

  useSheetBackHandler({
    disabled: busy,
    onDismiss: () => onOpenChange(false),
    open,
  })

  return (
    <Sheet
      dismissOnOverlayPress
      dismissOnSnapToBottom
      modal
      onAnimationComplete={({ open: animationOpen }) =>
        onAnimationComplete(animationOpen)
      }
      onOpenChange={onOpenChange}
      open={open}
      snapPointsMode="fit"
    >
      <Sheet.Overlay bg="transparent" overflow="hidden">
        <BlurView
          blurMethod="dimezisBlurView"
          blurReductionFactor={3}
          blurTarget={blurTarget}
          intensity={45}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          tint={themeName.startsWith("dark") ? "dark" : "light"}
        />
      </Sheet.Overlay>
      <Sheet.Handle bg="$color6" />
      <Sheet.Frame bg="$background" overflow="hidden">
        <QueryClientProvider client={queryClient}>
          {item && conversation ? (
            <YStack pb={Math.max(insets.bottom, 12)}>
              <ListItem
                bg="transparent"
                icon={
                  <ConversationAvatar
                    conversation={conversation}
                    server={server}
                    surroundingBackground="$background"
                  />
                }
                pointerEvents="none"
                size="$4"
                title={
                  <ListItemContent
                    meta={item.lastMessageTime}
                    subtitle={item.description}
                    subtitleLeading={
                      item.hasUnreadMention ? (
                        <SizableText color="$red10" fontWeight="600" size="$2">
                          [有人 @ 我]
                        </SizableText>
                      ) : undefined
                    }
                    subtitleTrailing={
                      <ConversationPreferenceIndicators
                        conversation={conversation}
                      />
                    }
                    title={conversation.name}
                  />
                }
              />

              <YStack
                bg="$backgroundLight"
                mt="$4"
                mx="$4"
                overflow="hidden"
                rounded="$4"
              >
                {!isBuiltinAssistantConversation(conversation) ? (
                  <>
                    <ConversationActionItem
                      disabled={busy}
                      icon={conversation.pinned ? PinOff : Pin}
                      loading={activeAction === "pin"}
                      onPress={() => onPinnedChange(!conversation.pinned)}
                      title={conversation.pinned ? "取消置顶" : "置顶对话"}
                    />
                    <Separator borderColor="$background" />
                  </>
                ) : null}

                <ConversationActionItem
                  disabled={busy}
                  icon={conversation.notificationMuted ? Bell : BellOff}
                  loading={activeAction === "mute"}
                  onPress={() =>
                    onMutedChange(!conversation.notificationMuted)
                  }
                  title={
                    conversation.notificationMuted
                      ? "取消免打扰"
                      : "消息免打扰"
                  }
                />

                <Separator borderColor="$background" />

                <ConversationActionItem
                  destructive
                  disabled={busy}
                  icon={Trash2}
                  onPress={onDelete}
                  title="删除对话"
                />
              </YStack>
            </YStack>
          ) : null}
        </QueryClientProvider>
      </Sheet.Frame>
    </Sheet>
  )
}

function ConversationActionItem({
  destructive = false,
  disabled,
  icon: Icon,
  loading = false,
  onPress,
  title,
}: {
  destructive?: boolean
  disabled: boolean
  icon: LucideIcon
  loading?: boolean
  onPress: () => void
  title: string
}) {
  const theme = useTheme()
  const color = String(destructive ? theme.red10.val : theme.color.val)

  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      {({ pressed }) => (
        <XStack
          bg={pressed ? "$backgroundPress" : "$backgroundLight"}
          height={52}
          items="center"
          justify="space-between"
          opacity={disabled && !loading ? 0.45 : 1}
          px="$4"
        >
          <SizableText color={destructive ? "$red10" : "$color"} size="$4">
            {title}
          </SizableText>
          {loading ? (
            <Spinner color={color} size="small" />
          ) : (
            <Icon color={color} size={16} strokeWidth={1.8} />
          )}
        </XStack>
      )}
    </Pressable>
  )
}
