import { isBuiltinAssistantConversation } from "@/domain/conversations/conversation-order"
import type { ConversationListItemModel } from "@/features/messages/conversation-list-model"
import { XGUIActionSheet } from "@/xgui"

export type ConversationAction = "mute" | "pin" | null

const ACTION_POST_CLOSE_DELAY_MS = 100

export function ConversationActionSheet({
  activeAction,
  item,
  onAnimationComplete,
  onDelete,
  onMutedChange,
  onOpenChange,
  onPinnedChange,
  open,
}: {
  activeAction: ConversationAction
  item: ConversationListItemModel | null
  onAnimationComplete: (open: boolean) => void
  onDelete: () => void
  onMutedChange: (muted: boolean) => void
  onOpenChange: (open: boolean) => void
  onPinnedChange: (pinned: boolean) => void
  open: boolean
}) {
  const conversation = item?.conversation
  const busy = activeAction !== null
  const actions = conversation
    ? [
        ...(conversation.type !== "topic" &&
        !isBuiltinAssistantConversation(conversation)
          ? [
              {
                deferUntilClosed: true,
                disabled: busy,
                label: conversation.pinned ? "取消置顶" : "置顶",
                onPress: () => {
                  setTimeout(
                    () => onPinnedChange(!conversation.pinned),
                    ACTION_POST_CLOSE_DELAY_MS
                  )
                },
              },
            ]
          : []),
        {
          deferUntilClosed: true,
          disabled: busy,
          label: conversation.notificationMuted ? "取消免打扰" : "免打扰",
          onPress: () => {
            setTimeout(
              () => onMutedChange(!conversation.notificationMuted),
              ACTION_POST_CLOSE_DELAY_MS
            )
          }
        },
        {
          destructive: true,
          disabled: busy,
          label: "删除",
          onPress: onDelete,
        },
      ]
    : []

  return (
    <XGUIActionSheet
      actions={actions}
      description={item?.description}
      descriptionNumberOfLines={1}
      onAnimationComplete={onAnimationComplete}
      onOpenChange={onOpenChange}
      open={open}
      title={conversation?.name}
      titleNumberOfLines={1}
    />
  )
}
