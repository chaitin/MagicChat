import type { ReactNode } from "react"
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native"

import { Text } from "@/components/mi-sans-text"
import { useXGUITheme } from "@/xgui"

type AppListItemProps = {
  accessibilityLabel: string
  children?: ReactNode
  disabled?: boolean
  onPress: () => void
  style?: StyleProp<ViewStyle>
  title?: string
  variant?: "outlined" | "unstyled"
}

export function AppListItem({
  accessibilityLabel,
  children,
  disabled = false,
  onPress,
  style,
  title,
  variant = "outlined",
}: AppListItemProps) {
  const { colors } = useXGUITheme()

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      pressRetentionOffset={0}
      style={({ pressed }) => [
        styles.pressTarget,
        variant === "outlined" && { borderColor: colors.separator, borderWidth: 1 },
        { backgroundColor: pressed ? colors.background1 : colors.background2 },
        style,
      ]}
    >
      <View style={styles.content}>
        {title ? <Text style={{ color: colors.textPrimary, fontSize: 15 }}>{title}</Text> : null}
        {children}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pressTarget: { alignSelf: "stretch", borderRadius: 9, minHeight: 44 },
  content: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 10 },
})
