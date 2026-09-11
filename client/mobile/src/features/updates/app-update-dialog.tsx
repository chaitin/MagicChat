import { SizableText, XStack, YStack } from "tamagui"

import type { AppRelease } from "@/features/updates/app-update-model"
import { XGUIDialog, XGUIProgress, useXGUITheme } from "@/xgui"

export type AppUpdateDialogStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"

export function AppUpdateDialog({
  onCancel,
  progress,
  release,
  status,
}: {
  onCancel: () => void
  progress: number
  release: AppRelease | null
  status: AppUpdateDialogStatus
}) {
  const { colors } = useXGUITheme()
  const percent = Math.round(progress * 100)

  return (
    <XGUIDialog
      actions={[{ label: "取消下载", onPress: onCancel }]}
      description={release ? `新版本 ${release.version}` : undefined}
      open={Boolean(release) && status === "downloading"}
      title="正在更新"
    >
      <YStack gap="$2" mt="$4">
        <XStack items="center" justify="space-between">
          <SizableText color={colors.textSecondary} size="$3">
            正在下载安装包
          </SizableText>
          <SizableText color={colors.brand} size="$3">
            {percent}%
          </SizableText>
        </XStack>
        <XGUIProgress
          accessibilityLabel="安装包下载进度"
          value={percent}
        />
      </YStack>
    </XGUIDialog>
  )
}
