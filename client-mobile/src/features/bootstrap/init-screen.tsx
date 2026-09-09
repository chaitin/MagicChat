import { useRouter } from "expo-router"
import { useEffect } from "react"
import { View } from "react-native"

import { useAuth } from "@/providers/auth-provider"
import { useServers } from "@/providers/server-provider"
import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export function InitScreen() {
  const router = useRouter()
  const { colors } = useXGUITheme()
  const {
    invalidateSession,
    isHydrated: isAuthHydrated,
    session,
  } = useAuth()
  const {
    isHydrated: areServersHydrated,
    selectServer,
    servers,
  } = useServers()

  useEffect(() => {
    if (!isAuthHydrated || !areServersHydrated) return

    let isActive = true

    async function routeFromPersistedSession() {
      if (!isActive) return

      const sessionServer = session
        ? servers.find(
            (server) =>
              server.id === session.id && server.url === session.url
          )
        : null

      if (session && sessionServer) {
        selectServer(session.id)
        router.replace("/messages")
        return
      }

      if (session) await invalidateSession()
      if (isActive) router.replace("/server-management")
    }

    void routeFromPersistedSession()

    return () => {
      isActive = false
    }
  }, [
    areServersHydrated,
    invalidateSession,
    isAuthHydrated,
    router,
    selectServer,
    servers,
    session,
  ])

  return <View style={{ backgroundColor: colors.background0, flex: 1 }} />
}
