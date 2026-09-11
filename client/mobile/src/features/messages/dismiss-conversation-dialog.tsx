import { XGUIActionSheet } from "@/xgui"

export function DismissConversationActionSheet({
  conversationName,
  deleting,
  onBeforeConfirm,
  onConfirm,
  onOpenChange,
  open,
}: {
  conversationName: string
  deleting: boolean
  onBeforeConfirm: () => void
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  return (
    <XGUIActionSheet
      actions={[
        {
          destructive: true,
          disabled: deleting,
          label: deleting ? "删除中…" : "删除",
          onBeforePress: onBeforeConfirm,
          onPress: onConfirm,
        },
      ]}
      description={`删除“${conversationName}”后，对话将暂时从列表中移除。收到新消息后会重新显示，聊天记录不会删除，也不会退出群聊。`}
      onOpenChange={onOpenChange}
      open={open}
      title="删除对话？"
    />
  )
}
