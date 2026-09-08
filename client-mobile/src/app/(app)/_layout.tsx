import { Redirect, Stack } from "expo-router"

import { useAuth } from "@/providers/auth-provider"
import { useXGUITheme } from "@/xgui"

export default function AppStackLayout() {
  const { isAuthenticated, isHydrated } = useAuth()
  const { colors } = useXGUITheme()

  if (!isHydrated) return null

  if (!isAuthenticated) {
    return <Redirect href="/server-management" />
  }

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background0 },
        headerShown: false,
      }}
    >
      <Stack.Screen name="(drawer)" />
      <Stack.Screen name="create-group" />
      <Stack.Screen name="conversation/[conversationId]" />
      <Stack.Screen name="conversation/[conversationId]/details" />
      <Stack.Screen name="conversation/[conversationId]/report" />
      <Stack.Screen name="conversation/[conversationId]/add-members" />
      <Stack.Screen name="conversation/[conversationId]/edit-group/[field]" />
      <Stack.Screen
        name="conversation/[parentConversationId]/topic/[conversationId]"
      />
      <Stack.Screen name="entity/[entityType]/[entityId]" />
      <Stack.Screen name="contacts/[category]" />
      <Stack.Screen name="office/projects" />
      <Stack.Screen name="search" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="profile-nickname" />
      <Stack.Screen name="account-deactivation" />
      <Stack.Screen name="media-picker" />
      <Stack.Screen name="qr-scanner" />
      <Stack.Screen name="qr-result" />
      <Stack.Screen name="qr-webview" />
      <Stack.Screen name="storage" />
    </Stack>
  )
}
