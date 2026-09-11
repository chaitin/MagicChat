import type { ColorSchemeName } from "react-native"

import { xguiColors } from "@/xgui/theme/colors"

const appThemes = {
  dark: {
    background: xguiColors.dark.background0,
    card: xguiColors.dark.background2,
    tamaguiTheme: "dark_teal",
  },
  light: {
    background: xguiColors.light.background0,
    card: xguiColors.light.background2,
    tamaguiTheme: "light_teal",
  },
} as const

export function resolveAppTheme(colorScheme: ColorSchemeName) {
  return colorScheme === "dark" ? appThemes.dark : appThemes.light
}

export const darkAppTheme = appThemes.dark
export const lightAppTheme = appThemes.light
