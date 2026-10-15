import { ChevronLeft, Menu } from "lucide-react-native"
import type { ComponentProps, ReactNode, Ref } from "react"
import { StyleSheet, View } from "react-native"
import { Text } from "@/components/mi-sans-text"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { CompactIconButton } from "@/components/buttons/compact-icon-button"
import { ConnectionTitle } from "@/components/navigation/connection-title"
import { useXGUITheme } from "@/xgui"

export const APP_HEADER_HEIGHT = 44

export type HeaderAction = {
  buttonRef?: Ref<View>
  icon: ComponentProps<typeof CompactIconButton>["icon"]
  iconColor?: string
  label: string
  onPress: () => void
  strokeWidth?: number
}

export function AppHeader({
  actions = [],
  backAccessory,
  onBackPress,
  onMenuPress,
  title,
  titleFontSize,
}: {
  actions?: HeaderAction[]
  backAccessory?: ReactNode
  onBackPress?: () => void
  onMenuPress?: () => void
  title: string
  titleFontSize?: number
}) {
  const insets = useSafeAreaInsets()
  const { colors } = useXGUITheme()

  return (
    <View style={{ backgroundColor: colors.background0, paddingTop: insets.top }}>
      <View style={styles.header}>
        <View style={styles.leading}>
          {onBackPress ? (
            <CompactIconButton
              accessibilityLabel="返回"
              icon={ChevronLeft}
              iconColor={colors.textPrimary}
              iconSize={26}
              onPress={onBackPress}
              strokeWidth={1.5}
            />
          ) : onMenuPress ? (
            <CompactIconButton
              accessibilityLabel="打开菜单"
              icon={Menu}
              iconSize={26}
              onPress={onMenuPress}
              strokeWidth={1.5}
            />
          ) : null}
          {onBackPress ? backAccessory : null}
        </View>

        <View style={styles.titleRow}>
          <ConnectionTitle color={colors.textPrimary} fontSize={titleFontSize ?? 16}>
            <Text
              numberOfLines={1}
              style={{
                color: colors.textPrimary,
                flex: 1,
                fontSize: titleFontSize ?? 16,
                lineHeight: Math.max(24, (titleFontSize ?? 16) + 4),
                textAlign: "center",
              }}
            >
              {title}
            </Text>
          </ConnectionTitle>
        </View>

        <View style={styles.actions}>
          {actions.slice(0, 2).map((action) => (
            <CompactIconButton
              accessibilityLabel={action.label}
              buttonRef={action.buttonRef}
              icon={action.icon}
              iconColor={action.iconColor}
              iconSize={26}
              key={action.label}
              onPress={action.onPress}
              strokeWidth={action.strokeWidth ?? 1.5}
            />
          ))}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    height: APP_HEADER_HEIGHT,
    paddingHorizontal: 13,
  },
  leading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
    width: 72,
  },
  titleRow: { alignItems: "center", flex: 1, flexDirection: "row", justifyContent: "center", minWidth: 0 },
  actions: {
    flexDirection: "row",
    gap: 2,
    justifyContent: "flex-end",
    width: 72,
  },
})
