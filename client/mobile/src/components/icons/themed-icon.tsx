import { type LucideIcon } from "lucide-react-native"
import { useTheme } from "tamagui"

export function ThemedIcon({
  color,
  icon: Icon,
  size = 20,
}: {
  color?: string
  icon: LucideIcon
  size?: number
}) {
  const theme = useTheme()

  return <Icon color={color ?? String(theme.color.val)} size={size} />
}
