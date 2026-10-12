import { focusManager, QueryClientProvider } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { AppState, View } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context"
import { startMobilePerfMonitoring } from "@/diagnostics/mobile-perf"
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
import { XGUIOverlayHost } from "@/xgui/components/xgui-overlay-host"
import { xguiColors } from "@/xgui/theme/colors"

export function AppProviders({ children }: React.PropsWithChildren) {
  const [queryClient] = useState(createClientQueryClient)

  useEffect(() => {
    const stopPerfMonitoring = startMobilePerfMonitoring()
    const subscription = AppState.addEventListener("change", (status) => {
      focusManager.setFocused(status === "active")
    })

    return () => {
      subscription.remove()
      stopPerfMonitoring()
    }
  }, [])

  return (
    <AppThemeProvider>
      {(scheme) => (
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider initialMetrics={initialWindowMetrics}>
              <XGUIToastProvider>
                <AppBlurTargetProvider>
                  <View style={{ backgroundColor: xguiColors[scheme].background2, flex: 1 }}>
                    <ServerProvider>
                      <PushCoordinatorProvider>
                        <AuthProvider>
                          <RealtimeProvider>
                            <ClientDataProvider>
                              <PushProvider>
                                <XGUIOverlayHost>{children}</XGUIOverlayHost>
                              </PushProvider>
                            </ClientDataProvider>
                          </RealtimeProvider>
                        </AuthProvider>
                      </PushCoordinatorProvider>
                    </ServerProvider>
                  </View>
                </AppBlurTargetProvider>
              </XGUIToastProvider>
            </SafeAreaProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      )}
    </AppThemeProvider>
  )
}
