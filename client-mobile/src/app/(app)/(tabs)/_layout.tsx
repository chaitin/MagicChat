import { Tabs as RouterTabs, useRouter } from "expo-router"
import type { Href } from "expo-router"
import { DrawerActions } from "expo-router/react-navigation"
import {
  BriefcaseBusiness,
  ContactRound,
  MessageCircleMore,
  Search,
  type LucideIcon,
} from "lucide-react-native"
import type { ComponentProps } from "react"
import { useState } from "react"
import { SizableText, Tabs, useTheme, YStack } from "tamagui"

import { AppHeader } from "@/components/navigation/app-header"

const TAB_ITEMS: Record<string, { icon: LucideIcon; label: string }> = {
  contacts: { icon: ContactRound, label: "通讯录" },
  messages: { icon: MessageCircleMore, label: "消息" },
  projects: { icon: BriefcaseBusiness, label: "项目" },
}

type AppTabBarProps = Parameters<
  NonNullable<ComponentProps<typeof RouterTabs>["tabBar"]>
>[0]

export default function AppTabsLayout() {
  const router = useRouter()
  const theme = useTheme()

  return (
    <RouterTabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: true,
        sceneStyle: {
          backgroundColor: String(theme.background.val),
        },
        tabBarHideOnKeyboard: true,
      }}
    >
      <RouterTabs.Screen
        name="messages"
        options={{
          header: ({ navigation }) => (
            <AppHeader
              actions={[
                {
                  icon: Search,
                  label: "搜索",
                  onPress: () => router.push("/search" as Href),
                },
              ]}
              onMenuPress={() =>
                navigation
                  .getParent()
                  ?.dispatch(DrawerActions.openDrawer())
              }
              title="消息"
            />
          ),
          title: "消息",
        }}
      />
      <RouterTabs.Screen
        name="contacts"
        options={{
          header: ({ navigation }) => (
            <AppHeader
              onMenuPress={() =>
                navigation
                  .getParent()
                  ?.dispatch(DrawerActions.openDrawer())
              }
              title="通讯录"
            />
          ),
          title: "通讯录",
        }}
      />
      <RouterTabs.Screen
        name="projects"
        options={{
          header: ({ navigation }) => (
            <AppHeader
              onMenuPress={() =>
                navigation
                  .getParent()
                  ?.dispatch(DrawerActions.openDrawer())
              }
              title="项目"
            />
          ),
          title: "项目",
        }}
      />
    </RouterTabs>
  )
}

function AppTabBar({ insets, navigation, state }: AppTabBarProps) {
  const activeRouteName = state.routes[state.index]?.name ?? "messages"

  function handleValueChange(routeName: string) {
    const route = state.routes.find((item) => item.name === routeName)
    if (!route) return

    const event = navigation.emit({
      canPreventDefault: true,
      target: route.key,
      type: "tabPress",
    })

    if (!event.defaultPrevented && route.name !== activeRouteName) {
      navigation.navigate(route.name, route.params)
    }
  }

  return (
    <YStack bg="$background" pb={insets.bottom}>
      <Tabs
        onValueChange={handleValueChange}
        size="$5"
        value={activeRouteName}
        width="100%"
      >
        <Tabs.List
          bg="transparent"
          borderWidth={0}
          height={56}
          rounded={0}
          width="100%"
        >
          {state.routes.map((route) => {
            const item = TAB_ITEMS[route.name]
            if (!item) return null

            const focused = route.name === activeRouteName

            return (
              <AppTabItem
                focused={focused}
                item={item}
                key={route.key}
                routeName={route.name}
              />
            )
          })}
        </Tabs.List>
      </Tabs>
    </YStack>
  )
}

function AppTabItem({
  focused,
  item,
  routeName,
}: {
  focused: boolean
  item: { icon: LucideIcon; label: string }
  routeName: string
}) {
  const theme = useTheme()
  const [pressed, setPressed] = useState(false)
  const colorToken = pressed ? "$color8" : focused ? "$color10" : "$gray9"
  const iconColor = pressed
    ? String(theme.color8.val)
    : focused
      ? String(theme.color10.val)
      : String(theme.gray9.val)
  const Icon = item.icon

  return (
    <Tabs.Tab
      accessibilityLabel={item.label}
      bg="transparent"
      flex={1}
      height="100%"
      items="center"
      justify="center"
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      unstyled
      value={routeName}
    >
      <YStack gap="$0.5" items="center">
        <Icon color={iconColor} size={20} />
        <SizableText color={colorToken} size="$2">
          {item.label}
        </SizableText>
      </YStack>
    </Tabs.Tab>
  )
}
