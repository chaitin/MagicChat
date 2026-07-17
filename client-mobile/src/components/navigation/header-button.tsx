import type { ReactNode } from "react"
import { Platform, Pressable } from "react-native"
import { Button, type GetProps } from "tamagui"

export type HeaderButtonProps = {
  accessibilityLabel: string
  children?: ReactNode
  circular?: boolean
  icon?: GetProps<typeof Button>["icon"]
  onPress: () => void
  size?: GetProps<typeof Button>["size"]
  subtlePress?: boolean
}

export function HeaderButton({
  accessibilityLabel,
  children,
  circular = false,
  icon,
  onPress,
  size = "$4",
  subtlePress = true,
}: HeaderButtonProps) {
  const button = (pressed = false) => (
    <Button
      accessible={Platform.OS === "web"}
      aria-label={accessibilityLabel}
      chromeless
      circular={circular}
      forceStyle={pressed ? "press" : undefined}
      icon={icon}
      onPress={Platform.OS === "web" ? onPress : undefined}
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
      onPress={onPress}
      pressRetentionOffset={0}
    >
      {({ pressed }) => button(pressed)}
    </Pressable>
  )
}
