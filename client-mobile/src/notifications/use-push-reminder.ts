import * as Application from "expo-application"
import { useEffect, useRef } from "react"
import { Alert, Linking, Platform } from "react-native"

import {
  clearPushReminder,
  recordPushReminder,
  setPushReminderExplicitlyDisabled,
  shouldShowPushReminder,
  type PushReminderKind,
} from "@/notifications/push-reminder"
import {
  loadPushReminderState,
  saveJPushConsent,
  updatePushReminderState,
} from "@/notifications/push-registration-store"
import { useAuth } from "@/providers/auth-provider"
import {
  usePushCoordinator,
  usePushSynchronizationState,
} from "@/providers/push-coordinator-provider"

let visibleReminder: PushReminderKind | null = null

export function usePushReminder() {
  const { isAuthenticated, isHydrated, isSigningOut } = useAuth()
  const coordinator = usePushCoordinator()
  const state = usePushSynchronizationState()
  const previousStateRef = useRef(state)
  const appVersion = Application.nativeApplicationVersion?.trim() || "unknown"

  useEffect(() => {
    const previous = previousStateRef.current
    previousStateRef.current = state
    if (state !== "registered" || previous === "registered") return
    void updatePushReminderState((current) =>
      clearPushReminder(
        setPushReminderExplicitlyDisabled(current, false),
        "permission"
      )
    ).catch(() => undefined)
  }, [state])

  useEffect(() => {
    if (
      (Platform.OS !== "android" && Platform.OS !== "ios") ||
      !isHydrated ||
      !isAuthenticated ||
      isSigningOut
    ) {
      return
    }

    const kind = reminderKindForState(state)
    if (!kind || visibleReminder) return
    visibleReminder = kind
    let cancelled = false

    void loadPushReminderState()
      .then(async (preference) => {
        if (
          cancelled ||
          !shouldShowPushReminder({ appVersion, kind, state: preference })
        ) {
          releaseReminder(kind)
          return
        }
        await updatePushReminderState((current) =>
          recordPushReminder(current, kind, appVersion)
        )
        if (cancelled) {
          releaseReminder(kind)
          return
        }
        if (kind === "consent") {
          showConsentReminder(kind, coordinator)
        } else {
          showPermissionReminder(kind)
        }
      })
      .catch(() => releaseReminder(kind))

    return () => {
      cancelled = true
    }
  }, [appVersion, coordinator, isAuthenticated, isHydrated, isSigningOut, state])
}

function reminderKindForState(state: ReturnType<typeof usePushSynchronizationState>) {
  if (state === "consent_required" && Platform.OS === "android") {
    return "consent" as const
  }
  if (state === "permission_denied") return "permission" as const
  return null
}

function showConsentReminder(
  kind: PushReminderKind,
  coordinator: ReturnType<typeof usePushCoordinator>
) {
  Alert.alert(
    "启用手机通知",
    "Android 通知由极光推送提供。启用后，极光 SDK 会处理完成通知投递所需的设备、系统、网络和应用标识信息；不会收到聊天账号、服务器地址或消息内容。",
    [
      {
        onPress: () => releaseReminder(kind),
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
            .then(() => coordinator.triggerSynchronization())
            .catch(() => {
              Alert.alert("启用失败", "无法保存通知授权，请稍后重试。")
            })
            .finally(() => releaseReminder(kind))
        },
        text: "同意并启用",
      },
    ],
    { cancelable: true, onDismiss: () => releaseReminder(kind) }
  )
}

function showPermissionReminder(kind: PushReminderKind) {
  Alert.alert(
    "开启系统通知",
    "系统通知权限或“消息通知”渠道尚未开启，开启后才能在后台收到新消息提醒。",
    [
      {
        onPress: () => releaseReminder(kind),
        style: "cancel",
        text: "暂不提醒",
      },
      {
        onPress: () => {
          releaseReminder(kind)
          void Linking.openSettings().catch(() => {
            Alert.alert("无法打开系统设置", "请手动进入系统设置并允许即应发送通知。")
          })
        },
        text: "去设置",
      },
    ],
    { cancelable: true, onDismiss: () => releaseReminder(kind) }
  )
}

function releaseReminder(kind: PushReminderKind) {
  if (visibleReminder === kind) visibleReminder = null
}
