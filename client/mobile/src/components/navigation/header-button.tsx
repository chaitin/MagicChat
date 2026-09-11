import type { ReactNode } from "react"
import { Platform, Pressable } from "react-native"
import { Button, type GetProps } from "tamagui"

export type HeaderButtonProps = {
  accessibilityLabel: string
  children?: ReactNode
  circular?: boolean
  disabled?: boolean
  icon?: GetProps<typeof Button>["icon"]
  onPress: () => void
  pressedOpacity?: number
  size?: GetProps<typeof Button>["size"]
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
  const button = (pressed = false) => (
    <Button
      accessible={Platform.OS === "web"}
      aria-label={accessibilityLabel}
      chromeless
      circular={circular}
      disabled={Platform.OS === "web" ? disabled : undefined}
      forceStyle={pressed ? "press" : undefined}
      icon={icon}
      onPress={Platform.OS === "web" && !disabled ? onPress : undefined}
      opacity={pressed ? pressedOpacity : 1}
      pointerEvents={Platform.OS === "web" ? "auto" : "none"}
      pressStyle={subtlePress ? { background: "$color1" } : undefined}
      size={size}
    >
      {children}
    </Button>
  )

  if (Platform.OS === "web") {
    return button()
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      pressRetentionOffset={0}
    >
      {({ pressed }) => button(pressed)}
    </Pressable>
  )
}
