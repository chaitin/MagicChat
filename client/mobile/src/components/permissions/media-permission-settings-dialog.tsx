import { useState } from "react"
import { Linking } from "react-native"

import type { MediaPermissionKind } from "@/features/permissions/media-permission"
import { XGUIDialog } from "@/xgui/components/xgui-dialog"

export function MediaPermissionSettingsDialog({
  kind,
  onCancel,
}: {
  kind: MediaPermissionKind | null
  onCancel: () => void
}) {
  const subject = kind === "camera" ? "相机" : "照片"
  const [settingsError, setSettingsError] = useState(false)

  function cancel() {
    setSettingsError(false)
    onCancel()
  }

  function openSettings() {
    setSettingsError(false)
    void Linking.openSettings().catch(() => setSettingsError(true))
  }

  return (
    <XGUIDialog
      actions={[
        { label: "取消", onPress: cancel },
        {
          label: "打开设置",
          onPress: openSettings,
          variant: "primary",
        },
      ]}
      description={
        settingsError
          ? `无法打开系统设置，请手动前往系统设置开启${subject}权限。`
          : `请在系统设置中允许即应访问${subject}。`
      }
      open={kind !== null}
      title={`需要${subject}权限`}
    />
  )
}
