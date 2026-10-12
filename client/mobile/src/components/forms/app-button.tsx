import type { ReactNode } from "react"
import { Pressable, StyleSheet, type ViewStyle } from "react-native"

import { Text } from "@/components/mi-sans-text"
import { useXGUITheme } from "@/xgui"

const buttonColors = {
  light: {
    gray: { color: "hsla(0, 0%, 13%, 1)", background: "hsla(0, 0%, 98%, 1)", backgroundPress: "hsla(0, 0%, 94%, 1)", borderColor: "hsla(0, 0%, 91%, 1)", borderColorPress: "hsla(0, 0%, 88%, 1)" },
    red: { color: "hsla(351, 63%, 24%, 1)", background: "hsla(0, 100%, 98%, 1)", backgroundPress: "hsla(357, 90%, 96%, 1)", borderColor: "hsla(358, 100%, 93%, 1)", borderColorPress: "hsla(359, 100%, 90%, 1)" },
  },
  dark: {
    gray: { color: "hsla(0, 0%, 93%, 1)", background: "hsla(0, 0%, 10%, 1)", backgroundPress: "hsla(0, 0%, 7%, 1)", borderColor: "hsla(0, 0%, 16%, 1)", borderColorPress: "hsla(0, 0%, 13%, 1)" },
    red: { color: "hsla(350, 100%, 91%, 1)", background: "hsla(355, 25%, 10%, 1)", backgroundPress: "hsla(0, 19%, 8%, 1)", borderColor: "hsla(348, 68%, 19%, 1)", borderColorPress: "hsla(350, 53%, 15%, 1)" },
  },
} as const

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
  const palette = buttonColors[colorScheme][theme]

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
              borderColor: pressed ? palette.borderColorPress : palette.borderColor,
            }
          : {
              backgroundColor: pressed ? palette.backgroundPress : palette.background,
              borderColor: "transparent",
            },
      ]}
      testID={testID}
    >
      {icon}
      {typeof children === "string" ? (
        <Text style={[styles.text, { color: palette.color }]}>{children}</Text>
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
