import type { PushSynchronizationState } from "@/notifications/push-coordinator"

export type PushStatusAction =
  | "none"
  | "enable_jpush"
  | "enable_notifications"
  | "open_settings"
  | "retry"
  | "show_device_limit"
  | "show_server_disabled"
  | "show_unauthorized"

export type PushStatusPresentation = {
  action: PushStatusAction
  label: string
}

const PRESENTATIONS: Record<
  PushSynchronizationState,
  PushStatusPresentation
> = {
  consent_required: {
    action: "enable_jpush",
    label: "未启用",
  },
  user_disabled: {
    action: "enable_notifications",
    label: "已关闭",
  },
  device_limit_reached: {
    action: "show_device_limit",
    label: "设备数量已达上限",
  },
  idle: { action: "retry", label: "准备启用" },
  permission_denied: {
    action: "open_settings",
    label: "通知权限未开启",
  },
  provider_unavailable: {
    action: "none",
    label: "安装包未配置",
  },
  registered: { action: "none", label: "已启用" },
  server_disabled: {
    action: "show_server_disabled",
    label: "服务器未启用",
  },
  synchronizing: { action: "none", label: "正在同步…" },
  temporarily_unavailable: {
    action: "retry",
    label: "暂时不可用",
  },
  unauthorized: {
    action: "show_unauthorized",
    label: "需要重新登录",
  },
}

export function presentPushSynchronizationState(
  state: PushSynchronizationState
) {
  return PRESENTATIONS[state]
}
