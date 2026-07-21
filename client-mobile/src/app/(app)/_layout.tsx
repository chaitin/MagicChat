import { Redirect, Stack } from "expo-router"

import { useAuth } from "@/features/auth/auth-context"

export default function AppStackLayout() {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return <Redirect href="/init" />
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(drawer)" />
      <Stack.Screen name="conversation/[conversationId]" />
      <Stack.Screen
        name="conversation/[parentConversationId]/topic/[conversationId]"
      />
      <Stack.Screen name="entity/[entityType]/[entityId]" />
      <Stack.Screen name="search" />
      <Stack.Screen name="theme-debug" />
    </Stack>
  )
}
