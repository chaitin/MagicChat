import { XGUIDialog } from "@/xgui"

export function NetworkFailureDialog({
  onRetry,
  onRelogin,
  open,
}: {
  onRetry: () => void
  onRelogin: () => void
  open: boolean
}) {
  return (
    <XGUIDialog
      actions={[
        {
          label: "重新登录",
          onPress: onRelogin,
          variant: "destructive",
        },
        {
          accessibilityLabel: "刷新服务器数据",
          label: "刷新",
          onPress: onRetry,
        },
      ]}
      description="无法连接到服务器，请检查网络后重试。"
      open={open}
      title="网络连接失败"
    />
  )
}
