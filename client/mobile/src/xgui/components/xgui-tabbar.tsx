import type { Icon as TablerIcon } from "@tabler/icons-react-native"
import type { ReactNode } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { XGUIBadge } from "@/xgui/components/xgui-badge"
import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

type XGUITabbarIcon = TablerIcon

export type XGUITabbarProps = {
  children: ReactNode
}

export type XGUITabbarItemProps = {
  active?: boolean
  activeIcon: XGUITabbarIcon
  accessibilityLabel?: string
  icon: XGUITabbarIcon
  label: string
  onPress: () => void
  unreadCount?: number
}

export function XGUITabbar({ children }: XGUITabbarProps) {
  const insets = useSafeAreaInsets()
  const { colors } = useXGUITheme()

  return (
    <View
      style={[
        styles.tabbar,
        {
          backgroundColor: colors.background1,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {children}
    </View>
  )
}

export function XGUITabbarItem({
  active = false,
  activeIcon: ActiveIcon,
  accessibilityLabel,
  icon: Icon,
  label,
  onPress,
  unreadCount = 0,
}: XGUITabbarItemProps) {
  const { colors } = useXGUITheme()
  const color = active ? colors.brand : colors.textPrimary
  const LabelIcon = active ? ActiveIcon : Icon
  const resolvedAccessibilityLabel =
    unreadCount > 0
      ? `${accessibilityLabel ?? label}，${unreadCount} 条未读消息`
      : accessibilityLabel ?? label

  return (
    <Pressable
      accessibilityLabel={resolvedAccessibilityLabel}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.item}
    >
      <View style={styles.icon}>
        <LabelIcon color={color} size={26} strokeWidth={1} />
        <XGUIBadge count={unreadCount} style={styles.badge} />
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          { color: active ? colors.brand : colors.textPrimary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    right: -8,
    top: -1,
  },
  icon: {
    alignItems: "center",
    height: 30,
    justifyContent: "center",
    marginBottom: 0,
    width: 30,
  },
  item: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingBottom: 6,
    paddingTop: 6,
  },
  label: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  tabbar: {
    flexDirection: "row",
    minHeight: 58,
    position: "relative",
    zIndex: 500,
  },
})
