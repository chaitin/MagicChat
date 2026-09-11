import AsyncStorage from "@react-native-async-storage/async-storage"
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router"
import { NavigationBar } from "expo-navigation-bar"
import { StatusBar } from "expo-status-bar"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { useColorScheme } from "react-native"

import { darkAppTheme, lightAppTheme, resolveAppTheme } from "@/config/app-theme"
import {
  parseThemePreference,
  resolveThemeScheme,
  THEME_PREFERENCE_STORAGE_KEY,
  type ResolvedScheme,
  type ThemePreference,
} from "@/config/theme-preference"

const lightNavigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: lightAppTheme.background,
    card: lightAppTheme.card,
  },
}
const darkNavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: darkAppTheme.background,
    card: darkAppTheme.card,
  },
}

type AppThemeContextValue = {
  preference: ThemePreference
  resolvedScheme: ResolvedScheme
  setPreference: (preference: ThemePreference) => void
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null)

export function AppThemeProvider({
  children,
}: {
  children: (tamaguiTheme: "dark_teal" | "light_teal") => ReactNode
}) {
  const systemScheme = useColorScheme()
  // Render immediately using the system theme; hydration updates this in place.
  const [preference, setPreferenceState] = useState<ThemePreference>("system")
  const preferenceRevision = useRef(0)
  const pendingWrite = useRef(Promise.resolve())
  const resolvedScheme = resolveThemeScheme(preference, systemScheme)
  const theme = resolveAppTheme(resolvedScheme)

  useEffect(() => {
    let cancelled = false
    const revision = preferenceRevision.current
    AsyncStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)
      .then((value) => {
        if (!cancelled && preferenceRevision.current === revision) {
          setPreferenceState(parseThemePreference(value))
        }
      })
      .catch(() => {
        if (!cancelled && preferenceRevision.current === revision) {
          setPreferenceState("system")
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setPreference = useCallback((value: ThemePreference) => {
    preferenceRevision.current += 1
    setPreferenceState(value)
    pendingWrite.current = pendingWrite.current
      .then(() => AsyncStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, value))
      .catch(() => undefined)
  }, [])
  const contextValue = { preference, resolvedScheme, setPreference }

  return (
    <AppThemeContext.Provider value={contextValue}>
      <ThemeProvider value={resolvedScheme === "dark" ? darkNavigationTheme : lightNavigationTheme}>
        <StatusBar style={resolvedScheme === "dark" ? "light" : "dark"} />
        <NavigationBar hidden={false} style={resolvedScheme === "dark" ? "light" : "dark"} />
        {children(theme.tamaguiTheme)}
      </ThemeProvider>
    </AppThemeContext.Provider>
  )
}

export function useAppTheme() {
  const value = useContext(AppThemeContext)
  if (!value) throw new Error("useAppTheme must be used within AppThemeProvider")
  return value
}
