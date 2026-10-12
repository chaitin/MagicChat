import type { ReactNode } from "react"
import { Pressable, StyleSheet, type ViewStyle } from "react-native"

import { tamaguiConfig } from "../../../tamagui.config"
import { Text } from "@/components/mi-sans-text"
import { useXGUITheme } from "@/xgui"

type AppButtonProps = {
  accessibilityLabel: string
  children: ReactNode
  disabled?: boolean
  grow?: number
  icon?: ReactNode
  onPress: () => void
  testID?: string
  theme?: "gray" | "red"
  variant?: "outlined"
  width?: ViewStyle["width"]
}

export function AppButton({
  accessibilityLabel,
  children,
  disabled = false,
  grow,
  icon,
  onPress,
  testID,
  theme = "gray",
  variant,
  width,
}: AppButtonProps) {
  const { colorScheme } = useXGUITheme()
  const palette = tamaguiConfig.themes[`${colorScheme}_${theme}`]

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { width, flexGrow: grow, flexBasis: grow ? 0 : undefined },
        variant === "outlined"
          ? {
              backgroundColor: "transparent",
              borderColor: pressed ? palette.borderColorPress.val : palette.borderColor.val,
            }
          : {
              backgroundColor: pressed ? palette.backgroundPress.val : palette.background.val,
              borderColor: "transparent",
            },
      ]}
      testID={testID}
    >
      {icon}
      {typeof children === "string" ? (
        <Text style={[styles.text, { color: palette.color.val }]}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: "row",
    gap: 18,
    height: 44,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  text: {
    fontSize: 15,
  },
})
