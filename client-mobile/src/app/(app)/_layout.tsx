import { Redirect } from "expo-router"
import { Drawer } from "expo-router/drawer"

import { AppDrawerContent } from "@/components/navigation/app-drawer-content"
import { useAuth } from "@/features/auth/auth-context"

export default function AppDrawerLayout() {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return <Redirect href="/init" />
  }

  return (
    <Drawer
      drawerContent={({ navigation }) => (
        <AppDrawerContent closeDrawer={() => navigation.closeDrawer()} />
      )}
      screenOptions={{
        headerShown: false,
        swipeEdgeWidth: 72,
      }}
    >
      <Drawer.Screen name="(tabs)" options={{ drawerLabel: "工作台" }} />
      <Drawer.Screen
        name="conversation/[conversationId]"
        options={{
          drawerItemStyle: { display: "none" },
          drawerLabel: "对话",
        }}
      />
      <Drawer.Screen
        name="conversation/[parentConversationId]/topic/[conversationId]"
        options={{
          drawerItemStyle: { display: "none" },
          drawerLabel: "话题",
        }}
      />
      <Drawer.Screen
        name="entity/[entityType]/[entityId]"
        options={{
          drawerItemStyle: { display: "none" },
          drawerLabel: "资料详情",
        }}
      />
      <Drawer.Screen
        name="search"
        options={{
          drawerItemStyle: { display: "none" },
          drawerLabel: "搜索",
        }}
      />
      <Drawer.Screen
        name="theme-debug"
        options={{
          drawerItemStyle: { display: "none" },
          drawerLabel: "主题调试",
        }}
      />
    </Drawer>
  )
}
