import { AlertDialog, Spinner, XStack } from "tamagui"

import { AppButton } from "@/components/forms/app-button"

export function DismissConversationDialog({
  conversationName,
  deleting,
  onConfirm,
  onOpenChange,
  open,
}: {
  conversationName: string
  deleting: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!deleting) onOpenChange(nextOpen)
      }}
      open={open}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay bg="$shadow6" opacity={0.5} />
        <AlertDialog.Content bordered elevate gap="$4" maxW={440} width="90%">
          <AlertDialog.Title fontSize="$4" lineHeight="$5">
            删除对话？
          </AlertDialog.Title>
          <AlertDialog.Description color="$gray9">
            删除“{conversationName}”后，对话将暂时从列表中移除。收到新消息后会重新显示，聊天记录不会删除，也不会退出群聊。
          </AlertDialog.Description>
          <XStack gap="$3" width="100%">
            <AppButton
              accessibilityLabel="取消删除对话"
              disabled={deleting}
              grow={1}
              onPress={() => onOpenChange(false)}
              theme="gray"
            >
              取消
            </AppButton>
            <AppButton
              accessibilityLabel="确认删除对话"
              disabled={deleting}
              grow={1}
              icon={deleting ? <Spinner /> : undefined}
              onPress={onConfirm}
              theme="red"
            >
              {deleting ? "删除中…" : "删除"}
            </AppButton>
          </XStack>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  )
}
