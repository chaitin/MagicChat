import type { ReactNode } from "react"
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { XGUILoadingIcon } from "@/xgui/components/xgui-loading-icon"
import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUILoadmoreVariant = "loading" | "line" | "dot"

export type XGUILoadmoreProps = {
  accessibilityLabel?: string
  children?: ReactNode
  style?: StyleProp<ViewStyle>
  variant?: XGUILoadmoreVariant
}

export function XGUILoadmore({
  accessibilityLabel,
  children,
  style,
  variant = "loading",
}: XGUILoadmoreProps) {
  const { colors } = useXGUITheme()
  const label = children ?? (variant === "loading" ? "正在加载" : undefined)

  return (
    <View
      accessibilityLabel={accessibilityLabel ?? (typeof label === "string" ? label : undefined)}
      accessibilityLiveRegion={variant === "loading" ? "polite" : "none"}
      accessibilityRole={variant === "loading" ? "progressbar" : "text"}
      style={[styles.loadmore, style]}
    >
      {variant === "line" ? (
        <View style={[styles.line, { backgroundColor: colors.separator }]} />
      ) : null}
      {variant === "loading" ? (
        <XGUILoadingIcon color={colors.textPlaceholder} size={20} />
      ) : null}
      {variant === "dot" ? (
        <View style={[styles.dot, { backgroundColor: colors.textPlaceholder }]} />
      ) : null}
      {label ? (
        <Text style={[styles.text, { color: colors.textPlaceholder }]}>
          {label}
        </Text>
      ) : null}
      {variant === "line" ? (
        <View style={[styles.line, { backgroundColor: colors.separator }]} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: 2,
    height: 4,
    width: 4,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  loadmore: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginVertical: 21,
    width: "65%",
  },
  text: {
    fontSize: 14,
    includeFontPadding: false,
    lineHeight: 22,
    textAlign: "center",
  },
})
