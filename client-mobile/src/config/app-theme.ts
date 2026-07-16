import type { ColorSchemeName } from "react-native"
import { getVariableValue } from "tamagui"

import { tamaguiConfig } from "../../tamagui.config"

const appThemes = {
  dark: {
    background: String(
      getVariableValue(tamaguiConfig.themes.dark_teal.background)
    ),
    tamaguiTheme: "dark_teal",
  },
  light: {
    background: String(
      getVariableValue(tamaguiConfig.themes.light_teal.background)
    ),
    tamaguiTheme: "light_teal",
  },
} as const

export function resolveAppTheme(colorScheme: ColorSchemeName) {
  return colorScheme === "dark" ? appThemes.dark : appThemes.light
}

export const darkAppTheme = appThemes.dark
export const lightAppTheme = appThemes.light
