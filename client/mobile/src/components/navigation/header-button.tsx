import type { ReactNode } from "react"
import { Pressable, StyleSheet } from "react-native"
import { Text } from "@/components/mi-sans-text"
import { useXGUITheme } from "@/xgui"

export type HeaderButtonProps = {
  accessibilityLabel: string
  children?: ReactNode
  circular?: boolean
  disabled?: boolean
  icon?: ReactNode
  onPress: () => void
  pressedOpacity?: number
  size?: "$3" | "$4" | "$5"
  subtlePress?: boolean
}

export function HeaderButton({
  accessibilityLabel,
  children,
  circular = false,
  disabled = false,
  icon,
  onPress,
  pressedOpacity = 1,
  size = "$4",
  subtlePress = true,
}: HeaderButtonProps) {
  const { colors } = useXGUITheme()
  const dimension = size === "$3" ? 36 : size === "$5" ? 52 : 44

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      pressRetentionOffset={0}
      style={({ pressed }) => [
        styles.button,
        {
          height: dimension,
          minWidth: circular ? dimension : undefined,
          paddingHorizontal: size === "$3" ? 13 : size === "$5" ? 24 : 18,
        },
        circular && { borderRadius: dimension / 2, paddingHorizontal: 0 },
        pressed && { opacity: pressedOpacity },
        pressed && subtlePress && { backgroundColor: colors.background1 },
      ]}
    >
      {icon}
      {typeof children === "string" ? (
        <Text style={{ color: colors.textPrimary }}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
})
