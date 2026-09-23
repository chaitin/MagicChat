import { Stack, usePathname } from "expo-router"
import { useFonts } from "expo-font"
import * as SplashScreen from "expo-splash-screen"
import { useEffect, useState } from "react"

import { AppProviders } from "@/providers/app-providers"
import { useAuth } from "@/providers/auth-provider"
import { useServers } from "@/providers/server-provider"

const MINIMUM_SPLASH_TIME_MS = 500

void SplashScreen.preventAutoHideAsync().catch(() => undefined)

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    "MiSans-Regular": require("../../assets/fonts/misans/MiSans-Regular.ttf"),
    "MiSans-Medium": require("../../assets/fonts/misans/MiSans-Medium.ttf"),
    "MiSans-Bold": require("../../assets/fonts/misans/MiSans-Bold.ttf"),
  })
  return (
    <AppProviders>
      <NativeSplashController fontsReady={fontsLoaded || Boolean(fontError)} />
      <Stack screenOptions={{ headerShown: false }}>
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
      </Stack>
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
