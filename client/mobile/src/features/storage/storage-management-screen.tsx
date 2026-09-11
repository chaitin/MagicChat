// Tabler exposes per-icon runtime entry points without per-icon declarations.
// eslint-disable-next-line import/no-unresolved
import IconDatabase from "@tabler/icons-react-native/IconDatabase"
// eslint-disable-next-line import/no-unresolved
import IconMessages from "@tabler/icons-react-native/IconMessages"
// eslint-disable-next-line import/no-unresolved
import IconPhoto from "@tabler/icons-react-native/IconPhoto"
// eslint-disable-next-line import/no-unresolved
import IconTrash from "@tabler/icons-react-native/IconTrash"
import { useRouter } from "expo-router"
import { useCallback, useEffect, useState } from "react"
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { AppHeader } from "@/components/navigation/app-header"
import {
  clearStorage,
  formatStorageSize,
  readStorageStats,
  type StorageStats,
} from "@/features/storage/storage-service"
import {
  XGUIActionSheet,
  XGUIList,
  XGUIListItem,
  useXGUITheme,
  useXGUIToast,
} from "@/xgui"

export function StorageManagementScreen() {
  const router = useRouter()
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [busy, setBusy] = useState(false)
  const [clearRequest, setClearRequest] = useState<ClearRequest | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setStats(await readStorageStats())
    } catch {
      Alert.alert("统计失败", "暂时无法读取存储空间，请稍后重试。")
    }
  }, [])

  useEffect(() => {
    let active = true
    readStorageStats()
      .then((value) => {
        if (active) setStats(value)
      })
      .catch(() => {
        if (active) {
          Alert.alert("统计失败", "暂时无法读取存储空间，请稍后重试。")
        }
      })
    return () => {
      active = false
    }
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }

  function confirm(parts: readonly StoragePart[], label: string) {
    if (busy) return
    setClearRequest({ label, parts })
  }

  async function runClear(parts: readonly StoragePart[], label: string) {
    if (busy) return
    setBusy(true)

    try {
      const { failed } = await clearStorage(parts)
      await refresh()
      if (!failed.length) {
        toast.show({ message: "清理完成", modal: false, type: "success" })
      } else if (failed.length === parts.length) {
        toast.show({ message: "清理失败，请稍后重试", modal: false, type: "error" })
      } else {
        const failedLabel = failed.includes("media") ? "媒体与文件" : "离线消息"
        toast.show({ message: `${failedLabel}清理失败`, modal: false, type: "error" })
      }
    } catch {
      toast.show({ message: `${label}清理失败，请稍后重试`, modal: false, type: "error" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <View style={[styles.screen, { backgroundColor: colors.background0 }]}>
        <AppHeader onBackPress={() => router.back()} title="存储空间" />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              colors={[colors.brand]}
              onRefresh={() => void handleRefresh()}
              refreshing={refreshing}
              tintColor={colors.brand}
            />
          }
          style={{ backgroundColor: colors.background0 }}
        >
          <View style={styles.content}>
            <XGUIList size="large">
              <StorageRow
                icon={IconPhoto}
                label="媒体与文件"
                value={stats ? formatStorageSize(stats.mediaBytes) : "统计中…"}
              />
              <StorageRow
                icon={IconMessages}
                label="离线消息"
                separator
                value={stats ? formatStorageSize(stats.messageBytes) : "统计中…"}
              />
              <StorageRow
                icon={IconDatabase}
                label="总计"
                separator
                value={stats ? formatStorageSize(stats.totalBytes) : "统计中…"}
              />
            </XGUIList>

            <XGUIList size="large">
              <XGUIListItem
                destructive
                disabled={busy}
                icon={({ color, size, strokeWidth }) => (
                  <IconTrash
                    color={color}
                    size={size}
                    strokeWidth={strokeWidth}
                  />
                )}
                minHeight={60}
                onPress={() => confirm(["media"], "媒体与文件")}
                title="清理媒体与文件"
                titleFontSize={18}
              />
              <XGUIListItem
                destructive
                disabled={busy}
                icon={({ color, size, strokeWidth }) => (
                  <IconTrash
                    color={color}
                    size={size}
                    strokeWidth={strokeWidth}
                  />
                )}
                minHeight={60}
                onPress={() => confirm(["messages"], "离线消息")}
                separator
                title="清理离线消息"
                titleFontSize={18}
              />
              <XGUIListItem
                destructive
                disabled={busy}
                icon={({ color, size, strokeWidth }) => (
                  <IconTrash
                    color={color}
                    size={size}
                    strokeWidth={strokeWidth}
                  />
                )}
                minHeight={60}
                onPress={() => confirm(["media", "messages"], "全部内容")}
                separator
                title="清理全部"
                titleFontSize={18}
              />
            </XGUIList>

            <Text style={[styles.note, { color: colors.textPlaceholder }]}>
              {"以上数据为全局统计，不区分账号。\n清理只会删除本机离线副本，不影响服务器数据。"}
            </Text>
          </View>
        </ScrollView>
      </View>

      <XGUIActionSheet
        actions={
          clearRequest
            ? [
                {
                  deferUntilClosed: true,
                  destructive: true,
                  label: `清理${clearRequest.label}`,
                  onBeforePress: () =>
                    toast.show({
                      duration: 0,
                      message: "正在清理",
                      type: "loading",
                    }),
                  onPress: () =>
                    void runClear(clearRequest.parts, clearRequest.label),
                },
              ]
            : []
        }
        description="本操作仅删除本机离线副本，不影响服务器数据。"
        onOpenChange={(open) => {
          if (!open) setClearRequest(null)
        }}
        open={clearRequest !== null}
        title={clearRequest ? `清理${clearRequest.label}` : "确认清理"}
      />
    </>
  )
}

type StoragePart = "media" | "messages"
type ClearRequest = {
  label: string
  parts: readonly StoragePart[]
}

function StorageRow({
  icon: Icon,
  label,
  separator = false,
  value,
}: {
  icon: typeof IconDatabase
  label: string
  separator?: boolean
  value: string
}) {
  return (
    <XGUIListItem
      icon={({ color, size, strokeWidth }) => (
        <Icon color={color} size={size} strokeWidth={strokeWidth} />
      )}
      minHeight={60}
      separator={separator}
      title={label}
      titleFontSize={18}
      value={value}
    />
  )
}

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    maxWidth: 440,
    width: "100%",
  },
  note: {
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    textAlign: "center",
  },
  screen: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
})
