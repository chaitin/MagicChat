import type { ReactNode } from "react"
import { Pressable, StyleSheet } from "react-native"
import { useXGUITheme } from "@/xgui"

type NativeIconButtonProps = {
  accessibilityLabel: string
  children: ReactNode
  disabled?: boolean
  onLongPress?: () => void
  onPress: () => void
  onPressIn?: () => void
  size?: number
}

export function NativeIconButton({
  accessibilityLabel,
  children,
  disabled = false,
  onLongPress,
  onPress,
  onPressIn,
  size = 36,
}: NativeIconButtonProps) {
  const { colorScheme, colors } = useXGUITheme()
  const pressedColor = colorScheme === "dark" ? colors.background5 : colors.background1
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onLongPress={onLongPress}
      onPress={onPress}
      onPressIn={onPressIn}
      style={({ pressed }) => [
        styles.button,
        { borderRadius: size / 2, height: size, width: size },
        pressed && { backgroundColor: pressedColor },
      ]}
    >
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: { alignItems: "center", justifyContent: "center" },
})
