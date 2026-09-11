import { useAppTheme } from "@/providers/app-theme-provider"
import { xguiColors } from "@/xgui/theme/colors"

export function useXGUITheme() {
  const { resolvedScheme } = useAppTheme()

  return {
    colorScheme: resolvedScheme,
    colors: xguiColors[resolvedScheme],
  }
}
