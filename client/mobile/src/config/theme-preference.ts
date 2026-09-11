import type { ColorSchemeName } from "react-native"

export const THEME_PREFERENCE_STORAGE_KEY = "@magicchat/theme-preference/v1"

export type ThemePreference = "system" | "light" | "dark"
export type ResolvedScheme = "light" | "dark"

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system"
}

export function resolveThemeScheme(
  preference: ThemePreference,
  systemScheme: ColorSchemeName
): ResolvedScheme {
  if (preference !== "system") return preference
  return systemScheme === "dark" ? "dark" : "light"
}
