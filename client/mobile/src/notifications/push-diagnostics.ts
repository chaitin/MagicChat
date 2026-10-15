import type { PushAccountIdentity } from "@/notifications/push-types"

export type PushRegistrationStage =
  | "permission"
  | "device_token"
  | "gateway"
  | "private_server"
export type PushRegistrationDiagnostic = {
  accountId: string | null
  generation: number | null
  stage: PushRegistrationStage
  status: "idle" | "running" | "registered" | "failed"
  code: string | null
}

let snapshot: PushRegistrationDiagnostic = {
  accountId: null,
  generation: null,
  stage: "permission",
  status: "idle",
  code: null,
}
const listeners = new Set<() => void>()
export function getPushRegistrationDiagnostic() {
  return snapshot
}
export function subscribePushRegistrationDiagnostic(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function updatePushRegistrationDiagnostic(
  identity: PushAccountIdentity,
  stage: PushRegistrationStage,
  status: PushRegistrationDiagnostic["status"] = "running",
  code: string | null = null,
) {
  snapshot = {
    accountId: identity.accountId,
    generation: identity.generation,
    stage,
    status,
    code,
  }
  for (const listener of listeners) listener()
}

export const PUSH_REGISTRATION_STAGE_LABELS: Record<
  PushRegistrationStage,
  string
> = {
  permission: "系统通知权限",
  device_token: "获取系统推送 Token",
  gateway: "推送网关注册与授权",
  private_server: "当前服务器绑定",
}

export function describePushJob(status?: string, reason?: string) {
  const reasons: Record<string, string> = {
    already_read: "已读，不再推送",
    mobile_foreground: "本机前台活跃，跳过推送",
    desktop_active: "电脑活跃，按设置暂停手机通知",
    policy_changed: "权限或免打扰设置变化，跳过推送",
    grant_inactive: "推送授权已失效",
    ttl_expired: "超过推送有效期",
  }
  if (reason && reasons[reason]) return reasons[reason]
  const states: Record<string, string> = {
    queued: "排队等待发送",
    sending: "发送中",
    retry: "临时失败，等待重试",
    sent: "推送网关已接收",
    accepted: "推送厂商已受理（不是手机送达回执）",
    suppressed: "按通知策略跳过",
    expired: "已过期",
    failed: "发送失败",
  }
  const label = status ? (states[status] ?? "状态暂不可识别") : "暂无推送任务"
  return reason ? `${label}（${reason}）` : label
}

export async function waitForPushDevice<T>(
  operation: Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(new Error("获取系统推送 Token 超时"), {
                code: "push_device_token_timeout",
              }),
            ),
          timeoutMs,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
