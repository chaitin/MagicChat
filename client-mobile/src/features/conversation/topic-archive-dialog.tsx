import { AlertDialog, Spinner, XStack } from "tamagui"

import { AppButton } from "@/components/forms/app-button"

export function TopicArchiveDialog({
  onConfirm,
  onOpenChange,
  open,
  saving,
}: {
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  saving: boolean
}) {
  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!saving) onOpenChange(nextOpen)
      }}
      open={open}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay bg="$shadow6" opacity={0.5} />
        <AlertDialog.Content bordered elevate gap="$4" maxW={440} width="90%">
          <AlertDialog.Title fontSize="$4" lineHeight="$5">
            确认关闭话题
          </AlertDialog.Title>
          <AlertDialog.Description color="$gray9">
            关闭后仍可查看话题，但无法继续发言，其他人也无法再参与。
          </AlertDialog.Description>
          <XStack gap="$3" width="100%">
            <AppButton
              accessibilityLabel="取消关闭话题"
              disabled={saving}
              grow={1}
              onPress={() => onOpenChange(false)}
              theme="gray"
            >
              取消
            </AppButton>
            <AppButton
              accessibilityLabel="确认关闭话题"
              disabled={saving}
              grow={1}
              icon={saving ? <Spinner /> : undefined}
              onPress={onConfirm}
              theme="red"
            >
              {saving ? "关闭中…" : "确认关闭"}
            </AppButton>
          </XStack>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  )
}
