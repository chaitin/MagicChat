import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIBadgeProps = {
  accessibilityLabel?: string
  backgroundColor?: string
  count: number
  dot?: boolean
  size?: "default" | "large"
  style?: StyleProp<ViewStyle>
  textColor?: string
}

export function XGUIBadge({
  accessibilityLabel,
  backgroundColor,
  count,
  dot = false,
  size = "default",
  style,
  textColor,
}: XGUIBadgeProps) {
  const { colors } = useXGUITheme()

  if (count <= 0) return null

  return (
    <View
      accessibilityElementsHidden={!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessible={Boolean(accessibilityLabel)}
      importantForAccessibility={
        accessibilityLabel ? "auto" : "no-hide-descendants"
      }
      style={[
        styles.badge,
        dot ? styles.dot : size === "large" ? styles.largeBadge : null,
        { backgroundColor: backgroundColor ?? colors.destructive },
        style,
      ]}
    >
      {dot ? null : (
        <Text
          style={[
            styles.text,
            size === "large" ? styles.largeText : null,
            textColor ? { color: textColor } : null,
          ]}
        >
          {count > 99 ? "99+" : count}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    borderRadius: 18,
    justifyContent: "center",
    minHeight: 18,
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  dot: {
    borderRadius: 5,
    minHeight: 10,
    minWidth: 10,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  largeBadge: {
    borderRadius: 22,
    minHeight: 22,
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  largeText: {
    fontSize: 14,
    fontWeight: "600",
    includeFontPadding: false,
    lineHeight: 18,
    textAlignVertical: "center",
  },
  text: {
    color: "#FFFFFF",
    fontSize: 12,
    lineHeight: 14,
    textAlign: "center",
  },
})
