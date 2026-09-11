import { focusManager, QueryClientProvider } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { AppState } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context"
import { TamaguiProvider, YStack } from "tamagui"

import { tamaguiConfig } from "../../tamagui.config"
import { AppThemeProvider } from "@/providers/app-theme-provider"
import { createClientQueryClient } from "@/data/query"
import { AuthProvider } from "@/providers/auth-provider"
import { ServerProvider } from "@/providers/server-provider"
import { ClientDataProvider } from "@/providers/client-data-provider"
import { AppBlurTargetProvider } from "@/providers/app-blur-target"
import { PushCoordinatorProvider } from "@/providers/push-coordinator-provider"
import { PushProvider } from "@/providers/push-provider"
import { RealtimeProvider } from "@/providers/realtime-provider"
import { XGUIToastProvider } from "@/xgui"

export function AppProviders({ children }: React.PropsWithChildren) {
  const [queryClient] = useState(createClientQueryClient)

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      focusManager.setFocused(status === "active")
    })

    return () => subscription.remove()
  }, [])

  return (
    <AppThemeProvider>
      {(tamaguiTheme) => (
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider initialMetrics={initialWindowMetrics}>
              <TamaguiProvider
                config={tamaguiConfig}
                defaultTheme={tamaguiTheme}
              >
                <XGUIToastProvider>
                  <AppBlurTargetProvider>
                    <YStack bg="$background" flex={1}>
                      <ServerProvider>
                        <PushCoordinatorProvider>
                          <AuthProvider>
                            <RealtimeProvider>
                              <ClientDataProvider>
                                <PushProvider>{children}</PushProvider>
                              </ClientDataProvider>
                            </RealtimeProvider>
                          </AuthProvider>
                        </PushCoordinatorProvider>
                      </ServerProvider>
                    </YStack>
                  </AppBlurTargetProvider>
                </XGUIToastProvider>
              </TamaguiProvider>
            </SafeAreaProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      )}
    </AppThemeProvider>
  )
}
