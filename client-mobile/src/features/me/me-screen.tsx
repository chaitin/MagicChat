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
import type { PushSynchronizationState } from "@/notifications/push-coordinator"
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
import { XGUIActionSheet, XGUIDialog, XGUIList, XGUIListItem, XGUIPicker, XGUISwitch, useXGUITheme, useXGUIToast, type XGUIDialogAction, type XGUIPickerItem } from "@/xgui"

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

type PushDialogKind = "consent" | "permission"

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
  const pushActivationRef = useRef(false)
  const themeSwitchFrameRef = useRef<number | null>(null)
  const {
    preference: themePreference,
    setPreference: setThemePreference,
  } = useAppTheme()
  const [themePickerOpen, setThemePickerOpen] = useState(false)
  const [pushSwitchEnabled, setPushSwitchEnabled] = useState(
    pushState === "registered"
  )
  const [pushDialog, setPushDialog] = useState<PushDialogKind | null>(null)
  const [pushDialogError, setPushDialogError] = useState("")
  const [pushDialogPending, setPushDialogPending] = useState(false)
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

  useEffect(() => {
    if (pushDialog !== "permission" || pushState !== "registered") return
    const timer = setTimeout(() => {
      setPushDialogError("")
      setPushDialog(null)
    }, 0)
    return () => clearTimeout(timer)
  }, [pushDialog, pushState])

  useEffect(() => {
    if (pushState === "synchronizing" || pushState === "idle") return
    const timer = setTimeout(
      () => setPushSwitchEnabled(pushState === "registered"),
      0
    )
    return () => clearTimeout(timer)
  }, [pushState])

  useEffect(() => {
    if (!pushActivationRef.current || pushState === "synchronizing") return
    pushActivationRef.current = false
    toast.hide()
    if (pushState === "registered") {
      toast.show({ message: "手机通知已开启", modal: false, type: "success" })
      return
    }
    if (pushState === "consent_required" || pushState === "permission_denied") {
      return
    }
    toast.show({
      message: getPushSynchronizationErrorMessage(pushState),
      modal: false,
      type: "error",
    })
  }, [pushState, toast])

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
    setPushDialogError("")
    switch (pushStatus.action) {
      case "enable_jpush":
        setPushDialog("consent")
        return
      case "enable_notifications":
        if (Platform.OS === "android") {
          setPushDialog("consent")
        } else {
          enablePushWithoutJPushConsent()
        }
        return
      case "open_settings":
        setPushDialog("permission")
        return
      case "retry":
        startPushSynchronization()
        return
      case "show_device_limit":
        toast.show({
          message: "通知设备数量已达上限，请先在其他设备退出登录。",
          modal: false,
          type: "error",
        })
        return
      case "show_server_disabled":
        toast.show({
          message: "当前服务器未启用手机通知。",
          modal: false,
          type: "text",
        })
        return
      case "show_unauthorized":
        toast.show({
          message: "登录状态已失效，请重新登录。",
          modal: false,
          type: "error",
        })
        return
      case "none":
        return
    }
  }

  function handlePushSwitchChange(enabled: boolean) {
    if (enabled) {
      handlePushStatusPress()
      return
    }
    disablePushImmediately()
  }

  function enablePushWithoutJPushConsent() {
    setPushSwitchEnabled(true)
    void updatePushReminderState((current) =>
      setPushReminderExplicitlyDisabled(current, false)
    )
      .then(startPushSynchronization)
      .catch(() => {
        setPushSwitchEnabled(false)
        toast.show({
          message: "无法保存通知设置，请稍后重试。",
          modal: false,
          type: "error",
        })
      })
  }

  function startPushSynchronization() {
    pushActivationRef.current = true
    setPushSwitchEnabled(true)
    toast.show({
      duration: 0,
      message: "正在开启手机通知…",
      modal: false,
      type: "loading",
    })
    pushCoordinator.triggerSynchronization()
  }

  function dismissPushDialog() {
    if (pushDialogPending) return
    if (pushDialog === "consent" || pushDialog === "permission") {
      void updatePushReminderState((current) =>
        recordPushReminder(
          current,
          pushDialog,
          pushReminderAppVersion
        )
      ).catch(() => undefined)
    }
    setPushDialogError("")
    setPushDialog(null)
  }

  function enablePushFromDialog() {
    setPushDialogPending(true)
    setPushDialogError("")
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
        setPushDialog(null)
        startPushSynchronization()
      })
      .catch(() => {
        setPushDialogError("无法保存通知授权，请稍后重试。")
      })
      .finally(() => setPushDialogPending(false))
  }

  function openPushSettings() {
    setPushDialogError("")
    void updatePushReminderState((current) =>
      recordPushReminder(
        current,
        "permission",
        pushReminderAppVersion
      )
    ).catch(() => undefined)
    void Linking.openSettings().catch(() => {
      setPushDialogError(
        "无法打开系统设置，请手动进入系统设置并允许即应发送通知。"
      )
    })
  }

  function disablePushImmediately() {
    setPushSwitchEnabled(false)
    void (async () => {
      if (active) {
        await pushCoordinator.queueRevocation({
          accountId: active.accountId,
          generation: active.generation,
          target: active.target,
        })
      }
      await Promise.all([
        saveJPushConsent(false),
        updatePushReminderState((current) =>
          setPushReminderExplicitlyDisabled(current, true)
        ),
      ])
      await stopJPush().catch(() => undefined)
      pushCoordinator.triggerSynchronization()
    })().catch(() => {
      setPushSwitchEnabled(true)
      toast.show({
        message: "暂时无法关闭手机通知，请稍后重试。",
        modal: false,
        type: "error",
      })
    })
  }

  const pushDialogContent = getPushDialogContent(pushDialog)
  const pushDialogActions: XGUIDialogAction[] =
    pushDialog === "consent"
      ? [
          {
            disabled: pushDialogPending,
            label: "暂不启用",
            onPress: dismissPushDialog,
          },
          {
            disabled: pushDialogPending,
            label: pushDialogPending ? "正在启用…" : "同意并启用",
            onPress: enablePushFromDialog,
            variant: "primary",
          },
        ]
      : [
          { label: "暂不提醒", onPress: dismissPushDialog },
          {
            label: "去设置",
            onPress: openPushSettings,
            variant: "primary",
          },
        ]

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
                  description={
                    pushState === "registered" ? undefined : pushStatus.label
                  }
                  icon={({ size, strokeWidth }) => <IconBell color={colors.brand} size={size} strokeWidth={strokeWidth} />}
                  separator
                  title="手机通知"
                  trailing={
                    <XGUISwitch
                      accessibilityLabel="手机通知"
                      disabled={
                        pushDialogPending ||
                        pushState === "synchronizing" ||
                        pushState === "provider_unavailable"
                      }
                      dimWhenDisabled={false}
                      onValueChange={handlePushSwitchChange}
                      value={pushSwitchEnabled}
                    />
                  }
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

      <XGUIDialog
        actions={pushDialogActions}
        description={pushDialogError || pushDialogContent.description}
        dismissible={!pushDialogPending}
        onOpenChange={(open) => {
          if (!open) dismissPushDialog()
        }}
        open={pushDialog !== null}
        title={pushDialogContent.title}
      />

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

function getPushSynchronizationErrorMessage(state: PushSynchronizationState) {
  switch (state) {
    case "server_disabled":
      return "当前服务器未启用手机通知。"
    case "device_limit_reached":
      return "通知设备数量已达上限。"
    case "unauthorized":
      return "登录状态已失效，请重新登录。"
    case "provider_unavailable":
      return "当前安装包不支持手机通知。"
    default:
      return "手机通知暂时不可用，请稍后重试。"
  }
}

function getPushDialogContent(kind: PushDialogKind | null) {
  switch (kind) {
    case "consent":
      return {
        description:
          "Android 通知由极光推送提供。启用后，极光 SDK 会处理完成通知投递所需的设备、系统、网络和应用标识信息；不会收到聊天账号、服务器地址或消息内容。",
        title: "启用手机通知",
      }
    case "permission":
      return {
        description:
          "系统通知权限或“消息通知”渠道尚未开启，开启后才能在后台收到新消息提醒。",
        title: "开启系统通知",
      }
    default:
      return { description: "", title: "手机通知" }
  }
}
