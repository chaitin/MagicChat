import type { Icon as TablerIcon } from "@tabler/icons-react-native"
// Tabler exposes per-icon runtime entry points without per-icon declarations.
// eslint-disable-next-line import/no-unresolved
import IconApps from "@tabler/icons-react-native/IconApps"
// eslint-disable-next-line import/no-unresolved
import IconRobotFace from "@tabler/icons-react-native/IconRobotFace"
// eslint-disable-next-line import/no-unresolved
import IconUserCircle from "@tabler/icons-react-native/IconUserCircle"
// eslint-disable-next-line import/no-unresolved
import IconUserPlus from "@tabler/icons-react-native/IconUserPlus"
// eslint-disable-next-line import/no-unresolved
import IconWorldMap from "@tabler/icons-react-native/IconWorldMap"
import { Pressable, StyleSheet, View } from "react-native"

import { ListItemContent } from "@/components/lists/list-item-content"
import type { DirectoryCategory } from "@/features/contacts/contact-directory-model"
import type { XGUIColors } from "@/xgui/theme/colors"
import {
  XGUIFilledSearchBar,
  useXGUITheme,
} from "@/xgui"

export type ContactDirectoryHomeEntry = {
  category: DirectoryCategory
  count: number
  label: string
}

export function ContactDirectoryHomeHeader({
  entries,
  onEntryPress,
  onSearchPress,
}: {
  entries: ContactDirectoryHomeEntry[]
  onEntryPress: (category: DirectoryCategory) => void
  onSearchPress: () => void
}) {
  const { colors } = useXGUITheme()

  return (
    <View>
      <XGUIFilledSearchBar
        accessibilityLabel="搜索联系人、应用和群组"
        onPress={onSearchPress}
      />
      <View style={{ backgroundColor: colors.background2 }}>
        {entries.map((entry, index) => {
          const Icon = getEntryIcon(entry.category)
          const iconBackgroundColor = getEntryColor(entry.category, colors)

          return (
            <Pressable
              accessibilityLabel={`打开${entry.label}`}
              accessibilityRole="button"
              key={entry.category}
              onPress={() => onEntryPress(entry.category)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed
                    ? colors.background1
                    : colors.background2,
                },
              ]}
            >
              <View style={styles.iconSlot}>
                <View
                  style={[
                    styles.iconBackground,
                    { backgroundColor: iconBackgroundColor },
                  ]}
                >
                  <Icon
                    color="#FFFFFF"
                    size={26}
                    strokeWidth={1.5}
                  />
                </View>
              </View>
              <View style={styles.entryContent}>
                <ListItemContent
                  subtitle={`${entry.count} 个`}
                  title={entry.label}
                />
              </View>
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
      <View style={[styles.contactGap, { backgroundColor: colors.background0 }]} />
    </View>
  )
}

function getEntryIcon(category: DirectoryCategory): TablerIcon {
  if (category === "new-friends") return IconUserPlus
  if (category === "my-apps") return IconRobotFace
  if (category === "all-apps") return IconApps
  if (category === "joined-groups") return IconUserCircle
  return IconWorldMap
}

function getEntryColor(category: DirectoryCategory, colors: XGUIColors) {
  if (category === "new-friends") return colors.orange
  if (category === "my-apps") return colors.brand
  if (category === "all-apps") return colors.indigo
  if (category === "joined-groups") return colors.yellow
  return colors.blue
}

const styles = StyleSheet.create({
  contactGap: {
    height: 8,
  },
  entryContent: {
    flex: 1,
    minWidth: 0,
  },
  iconBackground: {
    alignItems: "center",
    borderRadius: 8,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  iconSlot: {
    alignItems: "center",
    marginRight: 10,
    width: 44,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    height: 64,
    paddingHorizontal: 16,
    position: "relative",
  },
  separator: {
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    left: 68,
    position: "absolute",
    right: 16,
  },
})
