import { type LucideIcon } from "lucide-react-native"

import { useXGUITheme } from "@/xgui"

export function ThemedIcon({
  color,
  icon: Icon,
  size = 20,
}: {
  color?: string
  icon: LucideIcon
  size?: number
}) {
  const { colors } = useXGUITheme()

  return <Icon color={color ?? colors.textPrimary} size={size} />
}
