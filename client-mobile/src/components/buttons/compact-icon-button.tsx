import type { LucideIcon } from "lucide-react-native"
import { Pressable } from "react-native"
import { Button, Spinner, useTheme } from "tamagui"

const DEFAULT_BUTTON_SIZE = 30
const HIT_SLOP = 7

export function CompactIconButton({
  accessibilityLabel,
  buttonSize = DEFAULT_BUTTON_SIZE,
  disabled = false,
  icon,
  iconSize = 20,
  loading = false,
  onPress,
  strokeWidth = 2,
}: {
  accessibilityLabel: string
  buttonSize?: number
  disabled?: boolean
  icon: LucideIcon
  iconSize?: number
  loading?: boolean
  onPress: () => void
  strokeWidth?: number
}) {
  const theme = useTheme()
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
      style={{ height: resolvedButtonSize, width: resolvedButtonSize }}
    >
      {({ pressed }) => (
        <Button
          accessible={false}
          bg="transparent"
          chromeless
          circular
          height={resolvedButtonSize}
          icon={
            loading ? (
              <Spinner color="$color10" size="small" />
            ) : (
              <Icon
                color={String(
                  disabled
                    ? theme.gray8.val
                    : pressed
                      ? theme.color7.val
                      : theme.color10.val
                )}
                size={iconSize}
                strokeWidth={strokeWidth}
              />
            )
          }
          minH={0}
          minW={0}
          p={0}
          pointerEvents="none"
          pressStyle={{ bg: "transparent" }}
          width={resolvedButtonSize}
        />
      )}
    </Pressable>
  )
}
