import type { Icon as TablerIcon } from "@tabler/icons-react-native"
// Tabler exposes per-icon runtime entry points without per-icon declarations.
// eslint-disable-next-line import/no-unresolved
import IconBriefcase from "@tabler/icons-react-native/IconBriefcase"
// eslint-disable-next-line import/no-unresolved
import IconCalendar from "@tabler/icons-react-native/IconCalendar"
// eslint-disable-next-line import/no-unresolved
import IconCheckbox from "@tabler/icons-react-native/IconCheckbox"
// eslint-disable-next-line import/no-unresolved
import IconChevronRight from "@tabler/icons-react-native/IconChevronRight"
// eslint-disable-next-line import/no-unresolved
import IconFileText from "@tabler/icons-react-native/IconFileText"
// eslint-disable-next-line import/no-unresolved
import IconTarget from "@tabler/icons-react-native/IconTarget"
import { useRouter, type Href } from "expo-router"
import { PixelRatio, Pressable, StyleSheet, Text, View } from "react-native"

import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import type { XGUIColors } from "@/xgui/theme/colors"
import { useXGUITheme, useXGUIToast } from "@/xgui"

type OfficeEntryKey = "calendar" | "documents" | "goals" | "projects" | "tasks"

type OfficeEntry = {
  icon: TablerIcon
  key: OfficeEntryKey
  label: string
}

const OFFICE_ENTRIES: OfficeEntry[] = [
  { icon: IconBriefcase, key: "projects", label: "项目" },
  { icon: IconFileText, key: "documents", label: "文档" },
  { icon: IconCheckbox, key: "tasks", label: "任务" },
  { icon: IconCalendar, key: "calendar", label: "日历" },
  { icon: IconTarget, key: "goals", label: "目标" },
]
const OFFICE_ENTRY_GROUPS = [
  OFFICE_ENTRIES.slice(0, 1),
  OFFICE_ENTRIES.slice(1),
]
const OFFICE_ROW_HEIGHT = PixelRatio.roundToNearestPixel(60)

export function OfficeScreen() {
  const router = useRouter()
  const toast = useXGUIToast()
  const { colors } = useXGUITheme()

  function handleEntryPress(key: OfficeEntryKey) {
    if (key === "projects") {
      router.push("/office/projects" as Href)
      return
    }

    toast.show({
      duration: 1_000,
      message: "暂不支持查看",
      modal: false,
      type: "text",
    })
  }

  return (
    <KeyboardAwareScreen
      contentBackground={colors.background0}
      edges={[]}
      elastic
    >
      <View style={styles.groups}>
        {OFFICE_ENTRY_GROUPS.map((entries) => (
          <View
            key={entries[0]?.key}
            style={{ backgroundColor: colors.background2 }}
          >
            {entries.map((entry, index) => {
              const Icon = entry.icon

              return (
                <Pressable
                  accessibilityLabel={`打开${entry.label}`}
                  accessibilityRole="button"
                  key={entry.key}
                  onPress={() => handleEntryPress(entry.key)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: pressed
                        ? colors.background1
                        : colors.background2,
                    },
                  ]}
                >
                  <View style={styles.icon}>
                    <Icon
                      color={getEntryColor(entry.key, colors)}
                      size={26}
                      strokeWidth={1}
                    />
                  </View>
                  <Text style={[styles.label, { color: colors.textPrimary }]}>
                    {entry.label}
                  </Text>
                  <IconChevronRight
                    color={colors.textPlaceholder}
                    size={18}
                    strokeWidth={1}
                  />
                  {index < entries.length - 1 ? (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.separator,
                        { backgroundColor: colors.separator },
                      ]}
                    />
                  ) : null}
                </Pressable>
              )
            })}
          </View>
        ))}
      </View>
    </KeyboardAwareScreen>
  )
}

function getEntryColor(key: OfficeEntryKey, colors: XGUIColors) {
  if (key === "projects") return colors.brand
  if (key === "documents") return colors.blue
  if (key === "tasks") return colors.indigo
  if (key === "calendar") return colors.yellow
  return colors.destructive
}

const styles = StyleSheet.create({
  groups: {
    gap: 8,
    paddingTop: 8,
  },
  icon: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    marginRight: 12,
    width: 32,
  },
  label: {
    flex: 1,
    fontSize: 18,
    lineHeight: 24,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    height: OFFICE_ROW_HEIGHT,
    paddingHorizontal: 16,
    position: "relative",
  },
  separator: {
    bottom: StyleSheet.hairlineWidth,
    height: StyleSheet.hairlineWidth,
    left: 60,
    position: "absolute",
    right: 16,
  },
})
