import { View } from "react-native"

import { XGUIDialog, XGUILoadingIcon, useXGUITheme } from "@/xgui"

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
  const { colors } = useXGUITheme()

  return (
    <XGUIDialog
      actions={[
        {
          accessibilityLabel: "取消关闭话题",
          disabled: saving,
          label: "取消",
          onPress: () => onOpenChange(false),
        },
        {
          accessibilityLabel: "确认关闭话题",
          disabled: saving,
          label: saving ? "关闭中…" : "确认关闭",
          onPress: onConfirm,
          variant: "destructive",
        },
      ]}
      description="关闭后仍可查看话题，但无法继续发言，其他人也无法再参与。"
      dismissible={!saving}
      onOpenChange={onOpenChange}
      open={open}
      title="确认关闭话题"
    >
      {saving ? (
        <View style={{ alignItems: "center", marginTop: 12 }}>
          <XGUILoadingIcon color={colors.destructive} size={20} />
        </View>
      ) : null}
    </XGUIDialog>
  )
}
