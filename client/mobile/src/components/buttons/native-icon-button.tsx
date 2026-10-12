import type { ReactNode } from "react"
import { Pressable, StyleSheet } from "react-native"
import { tamaguiConfig } from "../../../tamagui.config"
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
  const { colorScheme } = useXGUITheme()
  const pressedColor = tamaguiConfig.themes[`${colorScheme}_teal`].backgroundPress.val
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
