import type { ReactNode } from "react"
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native"

import { XGUILoadingIcon } from "@/xgui/components/xgui-loading-icon"
import type { XGUIColors } from "@/xgui/theme/colors"
import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIButtonVariant = "primary" | "secondary" | "danger"
export type XGUIButtonSize = "default" | "mini" | "xmini"

export type XGUIButtonProps = Omit<
  PressableProps,
  "children" | "disabled" | "style"
> & {
  children: ReactNode
  disabled?: boolean
  loading?: boolean
  size?: XGUIButtonSize
  style?: StyleProp<ViewStyle>
  textStyle?: StyleProp<TextStyle>
  variant?: XGUIButtonVariant
}

export function XGUIButton({
  accessibilityLabel,
  children,
  disabled = false,
  loading = false,
  size = "default",
  style,
  textStyle,
  variant = "primary",
  ...pressableProps
}: XGUIButtonProps) {
  const { colors } = useXGUITheme()
  const unavailable = disabled || loading
  const textColor = resolveTextColor(variant, disabled, colors)

  return (
    <Pressable
      {...pressableProps}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: unavailable }}
      disabled={unavailable}
      style={({ pressed }) => [
        styles.button,
        size === "mini" && styles.miniButton,
        size === "xmini" && styles.xminiButton,
        {
          backgroundColor: resolveBackgroundColor(variant, disabled, colors),
        },
        style,
      ]}
    >
      {({ pressed }) => (
        <>
          {pressed && !unavailable ? (
            <View
              pointerEvents="none"
              style={[styles.activeMask, { backgroundColor: colors.activeMask }]}
            />
          ) : null}
          {loading ? (
            <XGUILoadingIcon
              color={variant === "secondary" ? "#606060" : "#EDEDED"}
              size={20}
            />
          ) : null}
          {typeof children === "string" ? (
            <Text
              style={[
                styles.text,
                size === "mini" && styles.miniText,
                size === "xmini" && styles.xminiText,
                { color: textColor },
                textStyle,
              ]}
            >
              {children}
            </Text>
          ) : (
            children
          )}
        </>
      )}
    </Pressable>
  )
}

function resolveBackgroundColor(
  variant: XGUIButtonVariant,
  disabled: boolean,
  colors: XGUIColors
) {
  if (disabled) return colors.foreground5
  if (variant === "secondary") return colors.foreground5
  if (variant === "danger") return colors.destructive
  return colors.brand
}

function resolveTextColor(
  variant: XGUIButtonVariant,
  disabled: boolean,
  colors: XGUIColors
) {
  if (disabled) return colors.foreground4
  return variant === "secondary" ? colors.textPrimary : colors.textOnColor
}

const styles = StyleSheet.create({
  activeMask: {
    borderRadius: 8,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  button: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    minHeight: 48,
    overflow: "hidden",
    paddingHorizontal: 24,
    paddingVertical: 12,
    width: "100%",
  },
  miniButton: {
    borderRadius: 6,
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
    width: "auto",
  },
  xminiButton: {
    borderRadius: 4,
    minHeight: 28,
    paddingHorizontal: 12,
    paddingVertical: 4,
    width: "auto",
  },
  miniText: {
    fontSize: 14,
    lineHeight: 20,
  },
  xminiText: {
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  text: {
    fontSize: 17,
    fontWeight: "500",
    lineHeight: 24,
    textAlign: "center",
  },
})
