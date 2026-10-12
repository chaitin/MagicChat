import { StyleSheet, View } from "react-native"

import { Text } from "@/components/mi-sans-text"

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
      <View style={styles.progressContent}>
        <View style={styles.progressHeader}>
          <Text style={[styles.progressText, { color: colors.textSecondary }]}>
            正在下载安装包
          </Text>
          <Text style={[styles.progressText, { color: colors.brand }]}>
            {percent}%
          </Text>
        </View>
        <XGUIProgress
          accessibilityLabel="安装包下载进度"
          value={percent}
        />
      </View>
    </XGUIDialog>
  )
}

const styles = StyleSheet.create({
  progressContent: { gap: 7, marginTop: 18 },
  progressHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressText: { fontSize: 14, lineHeight: 21 },
})
