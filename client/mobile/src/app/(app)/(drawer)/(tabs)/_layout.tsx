// Tabler exposes per-icon runtime entry points without per-icon declarations.
// eslint-disable-next-line import/no-unresolved
import IconBook from "@tabler/icons-react-native/IconBook"
// eslint-disable-next-line import/no-unresolved
import IconBookFilled from "@tabler/icons-react-native/IconBookFilled"
// eslint-disable-next-line import/no-unresolved
import IconBriefcase from "@tabler/icons-react-native/IconBriefcase"
// eslint-disable-next-line import/no-unresolved
import IconBriefcaseFilled from "@tabler/icons-react-native/IconBriefcaseFilled"
// eslint-disable-next-line import/no-unresolved
import IconMessageCircle from "@tabler/icons-react-native/IconMessageCircle"
// eslint-disable-next-line import/no-unresolved
import IconMessageCircleFilled from "@tabler/icons-react-native/IconMessageCircleFilled"
// eslint-disable-next-line import/no-unresolved
import IconCirclePlus from "@tabler/icons-react-native/IconCirclePlus"
// eslint-disable-next-line import/no-unresolved
import IconZoomScanFilled from "@tabler/icons-react-native/IconZoomScanFilled"
// eslint-disable-next-line import/no-unresolved
import IconSettings from "@tabler/icons-react-native/IconSettings"
// eslint-disable-next-line import/no-unresolved
import IconSettingsFilled from "@tabler/icons-react-native/IconSettingsFilled"
// eslint-disable-next-line import/no-unresolved
import IconUserFilled from "@tabler/icons-react-native/IconUserFilled"
import { Tabs as RouterTabs, type Href, useRouter } from "expo-router"
import { useRef, useState, type ComponentProps } from "react"
import type { View } from "react-native"

import { AppHeader } from "@/components/navigation/app-header"
import { notifyMessagesTabReselected } from "@/features/messages/messages-tab-reselect"
import { formatUnreadCount } from "@/features/messages/conversation-list-model"
import { buildCreateGroupConversationHref } from "@/navigation/conversations"
import { useClientConversations } from "@/providers/client-data-provider"
import {
  XGUIPopoverMenu,
  XGUITabbar,
  XGUITabbarItem,
  useXGUITheme,
} from "@/xgui"

const TAB_ITEMS = {
  contacts: {
    activeIcon: IconBookFilled,
    icon: IconBook,
    label: "通讯录",
  },
  me: {
    activeIcon: IconSettingsFilled,
    icon: IconSettings,
    label: "设置",
  },
  messages: {
    activeIcon: IconMessageCircleFilled,
    icon: IconMessageCircle,
    label: "消息",
  },
  projects: {
    activeIcon: IconBriefcaseFilled,
    icon: IconBriefcase,
    label: "办公",
  },
}

type AppTabBarProps = Parameters<
  NonNullable<ComponentProps<typeof RouterTabs>["tabBar"]>
>[0]

export default function AppTabsLayout() {
  const { conversations } = useClientConversations()
  const { colors } = useXGUITheme()
  const unreadMessageCount = conversations.reduce(
    (total, conversation) =>
      conversation.notificationMuted
        ? total
        : total + conversation.unreadCount,
    0
  )
  const messageTitle =
    unreadMessageCount > 0
      ? `消息 (${formatUnreadCount(unreadMessageCount)})`
      : "消息"

  return (
    <RouterTabs
      tabBar={(props) => (
        <AppTabBar {...props} unreadMessageCount={unreadMessageCount} />
      )}
      screenOptions={{
        animation: "fade",
        freezeOnBlur: true,
        headerShown: true,
        sceneStyle: {
          backgroundColor: colors.background0,
        },
        tabBarHideOnKeyboard: true,
      }}
    >
      <RouterTabs.Screen
        name="messages"
        options={{
          header: () => (
            <AppTabHeader title={messageTitle} titleFontSize={18} />
          ),
          title: "消息",
        }}
      />
      <RouterTabs.Screen
        name="contacts"
        options={{
          header: () => <AppTabHeader title="通讯录" />,
          title: "通讯录",
        }}
      />
      <RouterTabs.Screen
        name="projects"
        options={{
          header: () => <AppTabHeader title="办公" />,
          title: "办公",
        }}
      />
      <RouterTabs.Screen
        name="me"
        options={{
          header: () => <AppHeader title="设置" />,
          title: "设置",
        }}
      />
    </RouterTabs>
  )
}

function AppTabHeader({
  title,
  titleFontSize,
}: {
  title: string
  titleFontSize?: number
}) {
  const anchorRef = useRef<View>(null)
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const { colors } = useXGUITheme()

  return (
    <>
      <AppHeader
        actions={[
          {
            buttonRef: anchorRef,
            icon: IconCirclePlus,
            iconColor: colors.textPrimary,
            label: "新增",
            onPress: () => setMenuOpen(true),
            strokeWidth: 1,
          },
        ]}
        title={title}
        titleFontSize={titleFontSize}
      />
      <XGUIPopoverMenu
        anchorRef={anchorRef}
        items={[
          {
            icon: (props) => <IconMessageCircleFilled {...props} />,
            label: "发起群聊",
            onPress: () => router.push(buildCreateGroupConversationHref()),
          },
          {
            icon: (props) => <IconUserFilled {...props} />,
            label: "添加朋友",
            onPress: () => {
              setMenuOpen(false)
              router.push({
                params: { category: "new-friends" },
                pathname: "/(app)/contacts/[category]",
              } as unknown as Href)
            },
          },
          {
            icon: (props) => <IconZoomScanFilled {...props} />,
            label: "扫一扫",
            onPress: () => {
              setMenuOpen(false)
              router.push("/qr-scanner" as Href)
            },
          },
        ]}
        onOpenChange={setMenuOpen}
        open={menuOpen}
        width={140}
      />
    </>
  )
}

function AppTabBar({
  navigation,
  state,
  unreadMessageCount,
}: AppTabBarProps & { unreadMessageCount: number }) {
  const activeRouteName = state.routes[state.index]?.name ?? "messages"

  function handlePress(routeName: string) {
    const route = state.routes.find((item) => item.name === routeName)
    if (!route) return

    const event = navigation.emit({
      canPreventDefault: true,
      target: route.key,
      type: "tabPress",
    })

    if (event.defaultPrevented) return

    if (route.name === activeRouteName) {
      if (route.name === "messages" && unreadMessageCount > 0) {
        notifyMessagesTabReselected()
      }
      return
    }

    navigation.navigate(route.name, route.params)
  }

  return (
    <XGUITabbar>
      {state.routes.map((route) => {
        const item = TAB_ITEMS[route.name as keyof typeof TAB_ITEMS]
        if (!item) return null

        return (
          <XGUITabbarItem
            active={route.name === activeRouteName}
            activeIcon={item.activeIcon}
            icon={item.icon}
            key={route.key}
            label={item.label}
            onPress={() => handlePress(route.name)}
            unreadCount={
              route.name === "messages" ? unreadMessageCount : undefined
            }
          />
        )
      })}
    </XGUITabbar>
  )
}
