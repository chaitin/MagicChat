import { Drawer } from "expo-router/drawer"

import { AppDrawerContent } from "@/components/navigation/app-drawer-content"

export default function AppDrawerLayout() {
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
    </Drawer>
  )
}
