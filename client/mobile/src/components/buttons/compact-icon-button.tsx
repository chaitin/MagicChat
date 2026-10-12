import type { Icon as TablerIcon } from "@tabler/icons-react-native"
import type { LucideIcon } from "lucide-react-native"
import type { Ref } from "react"
import { Pressable, type View } from "react-native"

import { XGUILoadingIcon, useXGUITheme } from "@/xgui"

const DEFAULT_BUTTON_SIZE = 30
const HIT_SLOP = 7

export function CompactIconButton({
  accessibilityLabel,
  buttonRef,
  buttonSize = DEFAULT_BUTTON_SIZE,
  disabled = false,
  icon,
  iconColor,
  iconSize = 20,
  loading = false,
  onPress,
  strokeWidth = 2,
}: {
  accessibilityLabel: string
  buttonRef?: Ref<View>
  buttonSize?: number
  disabled?: boolean
  icon: LucideIcon | TablerIcon
  iconColor?: string
  iconSize?: number
  loading?: boolean
  onPress: () => void
  strokeWidth?: number
}) {
  const { colorScheme, colors } = useXGUITheme()
  const Icon = icon
  const resolvedButtonSize = Math.max(buttonSize, iconSize)

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      hitSlop={HIT_SLOP}
      onPress={onPress}
      pressRetentionOffset={0}
      ref={buttonRef}
      style={{
        alignItems: "center",
        height: resolvedButtonSize,
        justifyContent: "center",
        width: resolvedButtonSize,
      }}
    >
      {({ pressed }) => (
        loading ? (
          <XGUILoadingIcon color={colors.textPlaceholder} size={20} />
        ) : (
          <Icon
            color={
              disabled
                ? colors.textPlaceholder
                : iconColor ??
                  (pressed
                    ? colorScheme === "dark"
                      ? colors.brand2
                      : colors.brand1
                    : colors.brand5)
            }
            opacity={iconColor && pressed ? 0.5 : 1}
            size={iconSize}
            strokeWidth={strokeWidth}
          />
        )
      )}
    </Pressable>
  )
}
