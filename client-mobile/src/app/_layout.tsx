import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router"
import { NavigationBar } from "expo-navigation-bar"
import { StatusBar } from "expo-status-bar"
import { useColorScheme } from "react-native"

import { darkAppTheme, lightAppTheme } from "@/config/app-theme"
import { AppProviders } from "@/providers/app-providers"

const lightNavigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: lightAppTheme.background,
    card: lightAppTheme.background,
  },
}

const darkNavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: darkAppTheme.background,
    card: darkAppTheme.background,
  },
}

export default function RootLayout() {
  const colorScheme = useColorScheme()

  return (
    <AppProviders>
      <ThemeProvider
        value={colorScheme === "dark" ? darkNavigationTheme : lightNavigationTheme}
      >
        <StatusBar style="auto" />
        <NavigationBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="init" />
          <Stack.Screen name="login" />
          <Stack.Screen name="server-management" />
          <Stack.Screen name="(app)" />
        </Stack>
      </ThemeProvider>
    </AppProviders>
  )
}
