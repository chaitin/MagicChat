import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, useSyncExternalStore } from "react"
import { ScrollView, useWindowDimensions } from "react-native"
import { Text } from "@/components/mi-sans-text"
import { useAuth, useAuthenticatedSession } from "@/providers/auth-provider"
import {
  usePushCoordinator,
  usePushSynchronizationState,
} from "@/providers/push-coordinator-provider"
import { presentPushSynchronizationState } from "@/notifications/push-status-presentation"
import {
  getPushPreferences,
  setPushPreferences,
  getPushDeliveryStatus,
} from "@/notifications/push-private-server-api"
import { getGatewayDeliveryStatus } from "@/notifications/push-gateway-api"
import {
  loadPushDelegation,
  loadPushInstallation,
} from "@/notifications/push-registration-store"
import { targetsMatch } from "@/notifications/push-types"
import {
  describePushJob,
  getPushRegistrationDiagnostic,
  subscribePushRegistrationDiagnostic,
  PUSH_REGISTRATION_STAGE_LABELS,
} from "@/notifications/push-diagnostics"
import {
  XGUIDialog,
  XGUIListItem,
  XGUISwitch,
  useXGUITheme,
  useXGUIToast,
} from "@/xgui"

export function PushSettings() {
  const session = useAuthenticatedSession()
  const { active } = useAuth()
  const queryClient = useQueryClient()
  const toast = useXGUIToast()
  const { colors } = useXGUITheme()
  const { height } = useWindowDimensions()
  const coordinator = usePushCoordinator()
  const pushState = usePushSynchronizationState()
  const [open, setOpen] = useState(false)
  const registration = useSyncExternalStore(
    subscribePushRegistrationDiagnostic,
    getPushRegistrationDiagnostic,
    getPushRegistrationDiagnostic,
  )
  const preferenceKey = ["push-preferences", session.url, session.userId]
  const preferences = useQuery({
    queryKey: preferenceKey,
    queryFn: () => getPushPreferences(session),
    staleTime: 30_000,
  })
  const update = useMutation({
    mutationFn: (enabled: boolean) =>
      setPushPreferences(session, { pause_when_desktop_active: enabled }),
    onSuccess: (value) => queryClient.setQueryData(preferenceKey, value),
    onError: () =>
      toast.show({ type: "error", message: "保存通知设置失败，请重试" }),
  })
  const server = useQuery({
    queryKey: [
      "push-delivery-status",
      session.url,
      active?.accountId,
      active?.generation,
    ],
    queryFn: () => getPushDeliveryStatus(session),
    enabled: open,
    retry: false,
  })
  const gateway = useQuery({
    queryKey: [
      "push-gateway-status",
      session.url,
      active?.accountId,
      active?.generation,
    ],
    queryFn: async () => {
      const [installation, delegation] = await Promise.all([
        loadPushInstallation(),
        loadPushDelegation(),
      ])
      if (
        !installation ||
        !delegation ||
        delegation.installationId !== installation.installationId ||
        delegation.accountId !== active?.accountId ||
        !targetsMatch(delegation.target, session)
      )
        return null
      return getGatewayDeliveryStatus(
        delegation.grantId,
        installation.managementToken,
      )
    },
    enabled: open,
    retry: false,
  })
  const isCurrentRegistration =
    registration.accountId === active?.accountId &&
    registration.generation === active?.generation
  const stage = isCurrentRegistration
    ? `${PUSH_REGISTRATION_STAGE_LABELS[registration.stage]}：${registration.status === "registered" ? "完成" : registration.status === "failed" ? "失败" : registration.status === "running" ? "进行中" : "等待开始"}${registration.code ? `（${registration.code}）` : ""}`
    : "等待注册"
  const lines = [
    `客户端：${presentPushSynchronizationState(pushState).label}`,
    `注册环节：${stage}`,
    `服务器授权：${server.isError ? "读取失败" : server.isPending ? "读取中" : !server.data.enabled ? "服务器未启用" : server.data.registered ? "有效" : "尚未绑定或已失效"}`,
    `本机前台在线：${server.data ? (server.data.foreground ? "是" : "否或活跃租约已过期") : "未知"}`,
    `电脑活跃：${server.data ? (server.data.desktop_active ? "是" : "否") : "未知"}`,
    `发送前等待：${server.data?.delay_seconds ?? 5} 秒`,
    `服务器最近任务：${server.isError ? "读取失败" : describePushJob(server.data?.last_job?.status, server.data?.last_job?.reason)}`,
    `推送网关：${gateway.isError ? "读取失败" : gateway.isPending ? "读取中" : gateway.data ? `${gateway.data.provider.toUpperCase()} / ${gateway.data.environment} / ${gateway.data.installation_status === "active" && gateway.data.grant_status === "active" ? "授权有效" : "授权已失效"}` : "尚未建立当前账号授权"}`,
    `厂商最近任务：${gateway.isError ? "读取失败" : describePushJob(gateway.data?.last_job?.status, gateway.data?.last_job?.reason)}`,
  ]
  return (
    <>
      <XGUIListItem
        title="电脑活跃时暂停手机通知"
        description={
          preferences.isError
            ? "读取设置失败，点击重试"
            : "电脑前台使用且未空闲时生效，默认关闭"
        }
        descriptionNumberOfLines={2}
        separator
        onPress={
          preferences.isError
            ? () => {
                void preferences.refetch()
              }
            : undefined
        }
        trailing={
          <XGUISwitch
            accessibilityLabel="电脑活跃时暂停手机通知"
            disabled={!preferences.data || update.isPending}
            value={preferences.data?.pause_when_desktop_active ?? false}
            onValueChange={(value) => update.mutate(value)}
          />
        }
      />
      <XGUIListItem
        title="推送诊断"
        value={presentPushSynchronizationState(pushState).label}
        link
        onPress={() => setOpen(true)}
      />
      <XGUIDialog
        title="推送诊断"
        open={open}
        dismissible
        onOpenChange={setOpen}
        actions={[
          {
            label: "刷新",
            disabled: server.isFetching || gateway.isFetching,
            onPress: () => {
              coordinator.triggerSynchronization()
              void server.refetch()
              void gateway.refetch()
            },
          },
          { label: "关闭", onPress: () => setOpen(false) },
        ]}
      >
        <ScrollView
          style={{ maxHeight: height * 0.55 }}
          contentContainerStyle={{ gap: 6 }}
        >
          {lines.map((line) => (
            <Text
              key={line}
              style={{ color: colors.textSecondary, fontSize: 13 }}
            >
              {line}
            </Text>
          ))}
          <Text
            style={{ color: colors.textSecondary, fontSize: 12, marginTop: 6 }}
          >
            网关接收或厂商受理不代表手机已展示通知；这里不会显示设备
            Token、授权密钥或消息内容。
          </Text>
        </ScrollView>
      </XGUIDialog>
    </>
  )
}
