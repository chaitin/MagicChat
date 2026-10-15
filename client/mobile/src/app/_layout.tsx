import { Stack, usePathname } from "expo-router"
import { useFonts } from "expo-font"
import * as SplashScreen from "expo-splash-screen"
import { useEffect, useState } from "react"

import { initializeInputEmojiFallback } from "@/native/android-emoji-font-fallback"
import { AppProviders } from "@/providers/app-providers"
import { useAuth } from "@/providers/auth-provider"
import { useServers } from "@/providers/server-provider"

const MINIMUM_SPLASH_TIME_MS = 500

void SplashScreen.preventAutoHideAsync().catch(() => undefined)

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    JiyingEmoji: require("../../assets/fonts/emoji/JiyingEmoji.ttf"),
  })
  const [inputFontsInitialized, setInputFontsInitialized] = useState(false)
  useEffect(() => {
    if (!fontsLoaded && !fontError) return
    let active = true
    void initializeInputEmojiFallback().finally(() => {
      if (active) setInputFontsInitialized(true)
    })
    return () => { active = false }
  }, [fontError, fontsLoaded])
  const fontsReady = (fontsLoaded || Boolean(fontError)) && inputFontsInitialized
  return (
    <AppProviders>
      <NativeSplashController fontsReady={fontsReady} />
      {fontsReady ? <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="init" />
        <Stack.Screen name="login" />
        <Stack.Screen name="account-management" />
        <Stack.Screen name="server-management" />
        <Stack.Screen name="server-editor" />
        <Stack.Screen name="(app)" />
        <Stack.Screen
          name="image-preview"
          options={{ animation: "fade", presentation: "fullScreenModal" }}
        />
      </Stack> : null}
    </AppProviders>
  )
}

function NativeSplashController({ fontsReady }: { fontsReady: boolean }) {
  const pathname = usePathname()
  const { isAuthenticated, isHydrated: isAuthHydrated } = useAuth()
  const { isHydrated: areServersHydrated } = useServers()
  const [minimumTimeElapsed, setMinimumTimeElapsed] = useState(false)

  useEffect(() => {
    const timeout = setTimeout(
      () => setMinimumTimeElapsed(true),
      MINIMUM_SPLASH_TIME_MS
    )
    return () => clearTimeout(timeout)
  }, [])

  useEffect(() => {
    if (
      !fontsReady ||
      !isAuthHydrated ||
      !areServersHydrated ||
      !minimumTimeElapsed ||
      pathname === "/" ||
      pathname === "/init"
    ) {
      return
    }

    const routeIsReady = isAuthenticated
      ? true
      : pathname === "/login" ||
        pathname === "/account-management" ||
        pathname === "/server-editor" ||
        pathname === "/server-management"
    if (!routeIsReady) return

    void SplashScreen.hideAsync().catch(() => undefined)
  }, [
    fontsReady,
    areServersHydrated,
    isAuthenticated,
    isAuthHydrated,
    minimumTimeElapsed,
    pathname,
  ])

  return null
}
