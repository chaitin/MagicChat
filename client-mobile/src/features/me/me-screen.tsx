import * as Application from "expo-application"
import { useEffect, useRef, useState } from "react"
// eslint-disable-next-line import/no-unresolved
import IconBell from "@tabler/icons-react-native/IconBell"
// eslint-disable-next-line import/no-unresolved
import IconDatabase from "@tabler/icons-react-native/IconDatabase"
// eslint-disable-next-line import/no-unresolved
import IconDeviceDesktop from "@tabler/icons-react-native/IconDeviceDesktop"
// eslint-disable-next-line import/no-unresolved
import IconHelpCircle from "@tabler/icons-react-native/IconHelpCircle"
// eslint-disable-next-line import/no-unresolved
import IconLogout from "@tabler/icons-react-native/IconLogout"
// eslint-disable-next-line import/no-unresolved
import IconMoon from "@tabler/icons-react-native/IconMoon"
// eslint-disable-next-line import/no-unresolved
import IconPalette from "@tabler/icons-react-native/IconPalette"
// eslint-disable-next-line import/no-unresolved
import IconRefresh from "@tabler/icons-react-native/IconRefresh"
// eslint-disable-next-line import/no-unresolved
import IconSwitchHorizontal from "@tabler/icons-react-native/IconSwitchHorizontal"
// eslint-disable-next-line import/no-unresolved
import IconChevronRight from "@tabler/icons-react-native/IconChevronRight"
// eslint-disable-next-line import/no-unresolved
import IconSun from "@tabler/icons-react-native/IconSun"
import { useRouter, type Href } from "expo-router"
import { Alert, Linking, Platform, Pressable } from "react-native"
import {
  Card,
  Paragraph,
  SizableText,
  XStack,
  YStack,
} from "tamagui"

import { AppAvatar } from "@/components/avatar/app-avatar"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { appConfig } from "@/config/app-config"
import type { ThemePreference } from "@/config/theme-preference"
import { ApiRequestError } from "@/data/api-client"
import { useCachedAppInfo } from "@/data/auth/auth-hooks"
import { AppUpdateDialog } from "@/features/updates/app-update-dialog"
import { useAppUpdate } from "@/features/updates/use-app-update"
import { stopJPush } from "@/notifications/jpush-registration"
import {
  clearPushReminder,
  recordPushReminder,
  setPushReminderExplicitlyDisabled,
} from "@/notifications/push-reminder"
import {
  saveJPushConsent,
  updatePushReminderState,
} from "@/notifications/push-registration-store"
import { presentPushSynchronizationState } from "@/notifications/push-status-presentation"
import {
  useAuth,
  useAuthenticatedSession,
} from "@/providers/auth-provider"
import { useAppTheme } from "@/providers/app-theme-provider"
import { useClientSession } from "@/providers/client-data-provider"
import {
  usePushCoordinator,
  usePushSynchronizationState,
} from "@/providers/push-coordinator-provider"
import { XGUIActionSheet, XGUIList, XGUIListItem, XGUIPicker, useXGUITheme, useXGUIToast, type XGUIPickerItem } from "@/xgui"

const THEME_OPTIONS = [
  { icon: ({ color, size, strokeWidth }) => <IconDeviceDesktop color={color} size={size} strokeWidth={strokeWidth} />, label: "跟随系统", value: "system" },
  { icon: ({ color, size, strokeWidth }) => <IconSun color={color} size={size} strokeWidth={strokeWidth} />, label: "浅色主题", value: "light" },
  { icon: ({ color, size, strokeWidth }) => <IconMoon color={color} size={size} strokeWidth={strokeWidth} />, label: "深色主题", value: "dark" },
] satisfies readonly XGUIPickerItem<ThemePreference>[]

const THEME_LABELS: Record<ThemePreference, string> = {
  dark: "深色主题",
  light: "浅色主题",
  system: "跟随系统",
}

export function MeScreen() {
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const router = useRouter()
  const session = useAuthenticatedSession()
  const appInfoQuery = useCachedAppInfo(session)
  const { currentUser } = useClientSession()
  const { active, isSigningOut, phase, signOut } = useAuth()
  const pushCoordinator = usePushCoordinator()
  const pushReminderAppVersion =
    Application.nativeApplicationVersion?.trim() || "unknown"
  const pushState = usePushSynchronizationState()
  const pushStatus = presentPushSynchronizationState(pushState)
  const appUpdate = useAppUpdate()
  const updateConfirmedRef = useRef(false)
  const themeSwitchFrameRef = useRef<number | null>(null)
  const {
    preference: themePreference,
    setPreference: setThemePreference,
  } = useAppTheme()
  const [themePickerOpen, setThemePickerOpen] = useState(false)
  const [logoutSheetOpen, setLogoutSheetOpen] = useState(false)
  const [completedLogoutAccountId, setCompletedLogoutAccountId] = useState<string | null>(null)
  const [pendingTheme, setPendingTheme] = useState<ThemePreference>(themePreference)

  const organizationName =
    appInfoQuery.data?.organizationName ?? appConfig.organizationName
  const currentUserName =
    currentUser?.nickname.trim() ||
    currentUser?.name.trim() ||
    currentUser?.email ||
    "当前账号"

  function openThemePicker() {
    setPendingTheme(themePreference)
    setThemePickerOpen(true)
  }

  function handleThemeConfirm(value: ThemePreference) {
    if (value === themePreference) return

    toast.show({ duration: 0, message: "正在切换主题", type: "loading" })
    themeSwitchFrameRef.current = requestAnimationFrame(() => {
      setThemePreference(value)
      themeSwitchFrameRef.current = requestAnimationFrame(() => {
        themeSwitchFrameRef.current = null
        toast.hide()
      })
    })
  }

  useEffect(
    () => () => {
      if (themeSwitchFrameRef.current !== null) {
        cancelAnimationFrame(themeSwitchFrameRef.current)
        themeSwitchFrameRef.current = null
        toast.hide()
      }
    },
    [toast]
  )

  useEffect(() => {
    if (!completedLogoutAccountId || active?.accountId !== completedLogoutAccountId || phase !== "authenticated") return
    toast.hide()
    let secondFrame: number | null = null
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => router.dismissTo("/messages"))
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) cancelAnimationFrame(secondFrame)
    }
  }, [active?.accountId, completedLogoutAccountId, phase, router, toast])

  function confirmLogout() {
    if (isSigningOut) return
    setLogoutSheetOpen(true)
  }

  async function handleLogout() {
    toast.show({ duration: 0, message: "正在退出登录", modal: true, type: "loading" })
    try {
      const nextAccountId = await signOut()
      if (nextAccountId) setCompletedLogoutAccountId(nextAccountId)
      else toast.hide()
    } catch (error: unknown) {
      setCompletedLogoutAccountId(null)
      toast.show({
        message: error instanceof ApiRequestError
          ? error.message
          : "暂时无法退出登录，请稍后重试。",
        modal: false,
        type: "error",
      })
    }
  }

  function handlePushStatusPress() {
    switch (pushStatus.action) {
      case "enable_jpush":
        Alert.alert(
          "启用手机通知",
          "Android 通知由极光推送提供。启用后，极光 SDK 会处理完成通知投递所需的设备、系统、网络和应用标识信息；不会收到聊天账号、服务器地址或消息内容。",
          [
            {
              onPress: () => {
                void updatePushReminderState((current) =>
                  recordPushReminder(
                    current,
                    "consent",
                    pushReminderAppVersion
                  )
                ).catch(() => undefined)
              },
              style: "cancel",
              text: "暂不启用",
            },
            {
              onPress: () => {
                void Promise.all([
                  saveJPushConsent(true),
                  updatePushReminderState((current) =>
                    clearPushReminder(
                      setPushReminderExplicitlyDisabled(current, false),
                      "consent"
                    )
                  ),
                ])
                  .then(() => {
                    pushCoordinator.triggerSynchronization()
                  })
                  .catch(() => {
                    Alert.alert("启用失败", "无法保存通知授权，请稍后重试。")
                  })
              },
              text: "同意并启用",
            },
          ]
        )
        return
      case "open_settings":
        void Linking.openSettings().catch(() => {
          Alert.alert("无法打开系统设置", "请在系统设置中允许即应发送通知。")
        })
        return
      case "retry":
        pushCoordinator.triggerSynchronization()
        toast.show({ message: "正在重新同步通知", modal: false, type: "text" })
        return
      case "show_device_limit":
        Alert.alert(
          "通知设备数量已达上限",
          "当前账号最多启用 10 台通知设备。请先在其他设备退出登录，或联系服务器管理员处理。"
        )
        return
      case "show_server_disabled":
        Alert.alert("服务器未启用通知", "当前私有服务器没有开启公共推送功能。")
        return
      case "show_unauthorized":
        Alert.alert("需要重新登录", "当前登录状态已失效，请切换账号后重新登录。")
        return
      case "none":
        if (Platform.OS !== "android" || pushState !== "registered") return
        Alert.alert(
          "关闭手机通知",
          "关闭后将撤销当前账号的远程通知授权，并停止极光推送服务。",
          [
            { style: "cancel", text: "取消" },
            {
              onPress: () => {
                void (async () => {
                  if (active) {
                    await pushCoordinator
                      .deactivate({
                        accountId: active.accountId,
                        generation: active.generation,
                        target: active.target,
                      })
                      .catch(() => undefined)
                  }
                  await Promise.all([
                    saveJPushConsent(false),
                    updatePushReminderState((current) =>
                      setPushReminderExplicitlyDisabled(current, true)
                    ),
                  ])
                  await stopJPush().catch(() => undefined)
                  pushCoordinator.triggerSynchronization()
                })()
              },
              style: "destructive",
              text: "关闭",
            },
          ]
        )
        return
    }
  }

  function openHelpCenter() {
    void Linking.openURL(appConfig.helpCenterUrl).catch(() => {
      Alert.alert("无法打开帮助中心", "请稍后重试。")
    })
  }

  async function handleCheckForUpdates() {
    toast.show({ duration: 0, message: "正在检查更新", type: "loading" })
    try {
      const release = await appUpdate.checkForUpdates()
      toast.hide()
      if (!release) toast.show({ message: "已经是最新版本", modal: false, type: "success" })
    } catch (error: unknown) {
      toast.show({
        message: error instanceof Error ? error.message : "检查更新失败",
        modal: false,
        type: "error",
      })
    }
  }

  function startAvailableUpdate() {
    if (appUpdate.platform === "ios") {
      appUpdate.cancelUpdate()
      toast.show({ message: "iOS 暂不支持应用内安装，请联系管理员更新", modal: false, type: "text" })
      return
    }
    void appUpdate.startUpdate()
  }

  return (
    <>
      <KeyboardAwareScreen
        contentBackground={colors.background0}
        edges={[]}
        elastic
      >
        <YStack maxW={440} pb="$4" pt="$2" self="center" width="100%">
          <Card bg="$background" overflow="hidden" rounded={0}>
            <Pressable
              accessibilityLabel="个人信息"
              accessibilityRole="button"
              onPress={() => router.push("/profile" as Href)}
              style={({ pressed }) => ({
                backgroundColor: pressed
                  ? colors.background1
                  : colors.background2,
              })}
            >
              <XStack gap="$4" items="center" minH={116} px="$4" py="$4">
                <AppAvatar accessibilityLabel={currentUserName} avatar={currentUser?.avatar} server={session} size="$7" type="user" />
                <YStack flex={1} gap="$2" justify="center">
                  <SizableText
                    color={colors.textPrimary}
                    fontWeight="700"
                    numberOfLines={1}
                    size="$6"
                  >
                    {currentUserName}
                  </SizableText>
                  <Paragraph color="$gray10" numberOfLines={1} size="$3">
                    {organizationName}
                  </Paragraph>
                </YStack>
                <IconChevronRight
                  color={colors.textPlaceholder}
                  size={18}
                  strokeWidth={1}
                />
              </XStack>
            </Pressable>
          </Card>

          <YStack>
            <XGUIList size="large">
              <XGUIListItem
                icon={({ size, strokeWidth }) => <IconPalette color={colors.yellow} size={size} strokeWidth={strokeWidth} />}
                onPress={openThemePicker}
                title="外观主题"
                value={THEME_LABELS[themePreference]}
              />
              <XGUIListItem
                icon={({ size, strokeWidth }) => <IconDatabase color={colors.blue} size={size} strokeWidth={strokeWidth} />}
                onPress={() => router.push("/storage" as Href)}
                separator
                title="存储空间"
              />
              {Platform.OS === "ios" || Platform.OS === "android" ? (
                <XGUIListItem
                  icon={({ size, strokeWidth }) => <IconBell color={colors.brand} size={size} strokeWidth={strokeWidth} />}
                  onPress={
                    pushStatus.action === "none" &&
                    !(Platform.OS === "android" && pushState === "registered")
                      ? undefined
                      : handlePushStatusPress
                  }
                  separator
                  title="手机通知"
                  value={pushStatus.label}
                />
              ) : null}
            </XGUIList>

            <XGUIList size="large">
              <XGUIListItem
                icon={({ size, strokeWidth }) => <IconHelpCircle color={colors.brand} size={size} strokeWidth={strokeWidth} />}
                onPress={openHelpCenter}
                title="帮助与反馈"
              />
              <XGUIListItem
                disabled={appUpdate.status !== "idle"}
                separator
                icon={({ size, strokeWidth }) => <IconRefresh color={colors.brand} size={size} strokeWidth={strokeWidth} />}
                onPress={
                  appUpdate.status === "idle"
                    ? () => void handleCheckForUpdates()
                    : undefined
                }
                title="检查更新"
                value={appUpdate.installedVersion.label}
              />
            </XGUIList>

            <XGUIList size="large">
              <XGUIListItem
                centerContent
                destructive
                icon={({ color, size, strokeWidth }) => <IconSwitchHorizontal color={color} size={size} strokeWidth={strokeWidth} />}
                onPress={() => router.push("/account-management" as Href)}
                title="切换账号"
              />
            </XGUIList>

            <XGUIList size="large">
              <XGUIListItem
                centerContent
                destructive
                icon={({ color, size, strokeWidth }) => <IconLogout color={color} size={size} strokeWidth={strokeWidth} />}
                onPress={confirmLogout}
                title="退出登录"
              />
            </XGUIList>
          </YStack>
        </YStack>
      </KeyboardAwareScreen>

      <XGUIPicker
        columns={[THEME_OPTIONS]}
        onChange={([value]) => {
          if (value) setPendingTheme(value)
        }}
        onConfirm={([value]) => {
          if (value) handleThemeConfirm(value)
        }}
        onOpenChange={setThemePickerOpen}
        open={themePickerOpen}
        title="外观主题"
        value={[pendingTheme]}
      />

      <XGUIActionSheet
        actions={[
          {
            deferUntilClosed: true,
            destructive: true,
            label: "退出登录",
            onPress: () => void handleLogout(),
          },
        ]}
        description="确定要退出当前账号吗？"
        onOpenChange={setLogoutSheetOpen}
        open={logoutSheetOpen}
        title="退出登录"
      />

      <XGUIActionSheet
        actions={[
          {
            label: "更新",
            onBeforePress: () => {
              updateConfirmedRef.current = true
            },
            onPress: startAvailableUpdate,
          },
        ]}
        description={
          appUpdate.release
            ? `当前版本 ${appUpdate.installedVersion.version}，最新版本 ${appUpdate.release.version}`
            : undefined
        }
        onOpenChange={(open) => {
          if (!open && appUpdate.status === "available") {
            if (updateConfirmedRef.current) updateConfirmedRef.current = false
            else appUpdate.cancelUpdate()
          }
        }}
        open={appUpdate.status === "available"}
        title="发现新版本，是否更新？"
      />

      <AppUpdateDialog
        onCancel={appUpdate.cancelUpdate}
        progress={appUpdate.progress}
        release={appUpdate.release}
        status={appUpdate.status}
      />
    </>
  )
}
