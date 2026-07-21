import { createV5Theme, defaultConfig } from "@tamagui/config/v5"
import { animationsReactNative } from "@tamagui/config/v5-rn"
import { createTamagui } from "tamagui"

const themes = createV5Theme({
  getTheme: ({ scheme }) => ({
    backgroundLight:
      scheme === "light"
        ? "hsla(0, 0%, 95%, 1)"
        : "hsla(0, 0%, 5%, 1)",
  }),
})

const darkTealHalfStepColors = {
  color1: "hsla(174.01, 23.98%, 7.99%, 1)",
  color2: "hsla(174.46, 38.57%, 10.15%, 1)",
  color3: "hsla(175.07, 71.26%, 11.72%, 1)",
  color4: "hsla(175.53, 86.6%, 13.91%, 1)",
  color5: "hsla(174.49, 69.97%, 18.53%, 1)",
  color6: "hsla(174, 60.24%, 23.48%, 1)",
  color7: "hsla(173.5, 58.58%, 28.47%, 1)",
  color8: "hsla(172.94, 67.92%, 33.91%, 1)",
  color9: "hsla(172.5, 82.65%, 36.98%, 1)",
  color10: "hsla(171.09, 89.34%, 41.11%, 1)",
  color11: "hsla(165.19, 68.26%, 68.27%, 1)",
  color12: "hsla(163, 69%, 81%, 1)",
} as const

export const tamaguiConfig = createTamagui({
  ...defaultConfig,
  animations: animationsReactNative,
  themes: {
    ...themes,
    dark_teal: {
      ...themes.dark_teal,
      ...darkTealHalfStepColors,
      background: "hsla(175, 24%, 10%, 1)",
      backgroundLight: "hsla(174, 55%, 3%, 1)",
      backgroundPress: darkTealHalfStepColors.color2,
      borderColor: "hsla(174, 62%, 14%, 1)",
      gray9: themes.dark_gray.color9,
      gray12: themes.dark_gray.color12,
    },
    light_teal: {
      ...themes.light_teal,
      background: "hsla(165, 50%, 92%, 1)",
      backgroundLight: "hsla(165, 50%, 95%, 1)",
      borderColor: "hsla(166, 62%, 86%, 1)",
      gray9: themes.light_gray.color9,
      gray12: themes.light_gray.color12,
    },
  },
})

export type AppTamaguiConfig = typeof tamaguiConfig

declare module "tamagui" {
  interface TamaguiCustomConfig extends AppTamaguiConfig {}
}

export default tamaguiConfig
