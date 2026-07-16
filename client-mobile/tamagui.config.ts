import { defaultConfig } from "@tamagui/config/v5"
import { animationsReactNative } from "@tamagui/config/v5-rn"
import { createTamagui } from "tamagui"

export const tamaguiConfig = createTamagui({
  ...defaultConfig,
  animations: animationsReactNative,
  themes: {
    ...defaultConfig.themes,
    dark_teal: {
      ...defaultConfig.themes.dark_teal,
      gray9: defaultConfig.themes.dark_gray.color9,
      gray12: defaultConfig.themes.dark_gray.color12,
    },
    light_teal: {
      ...defaultConfig.themes.light_teal,
      gray9: defaultConfig.themes.light_gray.color9,
      gray12: defaultConfig.themes.light_gray.color12,
    },
  },
})

export type AppTamaguiConfig = typeof tamaguiConfig

declare module "tamagui" {
  interface TamaguiCustomConfig extends AppTamaguiConfig {}
}

export default tamaguiConfig
