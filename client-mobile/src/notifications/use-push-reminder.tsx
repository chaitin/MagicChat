import * as Application from "expo-application"
import { useEffect, useRef, useState } from "react"
import { Linking, Platform } from "react-native"

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
import { XGUIDialog } from "@/xgui"

export function PushReminderDialog() {
  const { isAuthenticated, isHydrated, isSigningOut } = useAuth()
  const coordinator = usePushCoordinator()
  const state = usePushSynchronizationState()
  const previousStateRef = useRef(state)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [reminder, setReminder] = useState<PushReminderKind | null>(null)
  const appVersion = Application.nativeApplicationVersion?.trim() || "unknown"

  useEffect(() => {
    const previous = previousStateRef.current
    previousStateRef.current = state
    if (state !== "registered" || previous === "registered") return
    setReminder(null)
    setError("")
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
    if (!kind || reminder) return
    let cancelled = false

    void loadPushReminderState()
      .then(async (preference) => {
        if (
          cancelled ||
          !shouldShowPushReminder({ appVersion, kind, state: preference })
        ) {
          return
        }
        await updatePushReminderState((current) =>
          recordPushReminder(current, kind, appVersion)
        )
        if (!cancelled) {
          setError("")
          setReminder(kind)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [appVersion, isAuthenticated, isHydrated, isSigningOut, reminder, state])

  function close() {
    if (pending) return
    setError("")
    setReminder(null)
  }

  function enableJPush() {
    setPending(true)
    setError("")
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
        setReminder(null)
        coordinator.triggerSynchronization()
      })
      .catch(() => {
        setError("无法保存通知授权，请稍后重试。")
      })
      .finally(() => setPending(false))
  }

  function openSettings() {
    setError("")
    void Linking.openSettings().catch(() => {
      setError("无法打开系统设置，请手动进入系统设置并允许即应发送通知。")
    })
  }

  const consent = reminder === "consent"
  return (
    <XGUIDialog
      actions={
        consent
          ? [
              {
                disabled: pending,
                label: "暂不启用",
                onPress: close,
              },
              {
                disabled: pending,
                label: pending ? "正在启用…" : "同意并启用",
                onPress: enableJPush,
                variant: "primary",
              },
            ]
          : [
              { label: "暂不提醒", onPress: close },
              {
                label: "去设置",
                onPress: openSettings,
                variant: "primary",
              },
            ]
      }
      description={
        error ||
        (consent
          ? "Android 通知由极光推送提供。启用后，极光 SDK 会处理完成通知投递所需的设备、系统、网络和应用标识信息；不会收到聊天账号、服务器地址或消息内容。"
          : "系统通知权限或“消息通知”渠道尚未开启，开启后才能在后台收到新消息提醒。")
      }
      dismissible={!pending}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      open={reminder !== null}
      title={consent ? "启用手机通知" : "开启系统通知"}
    />
  )
}

function reminderKindForState(
  state: ReturnType<typeof usePushSynchronizationState>
) {
  if (state === "consent_required" && Platform.OS === "android") {
    return "consent" as const
  }
  if (state === "permission_denied") return "permission" as const
  return null
}
