import type { DesktopPlatform } from "../../shared/desktop"

export type NotificationPermissionApi = {
  readonly permission: NotificationPermission
  requestPermission(): Promise<NotificationPermission>
}

export type NotificationPermissionState = NotificationPermission | "unsupported"

export function getNotificationPermission(
  api: NotificationPermissionApi | undefined,
  platform?: DesktopPlatform,
): NotificationPermissionState {
  return platform === "windows" ? "unsupported" : (api?.permission ?? "unsupported")
}

export function checkNotificationPermission(
  api: NotificationPermissionApi | undefined,
  request: boolean,
  platform?: DesktopPlatform,
): Promise<NotificationPermissionState> {
  const permission = getNotificationPermission(api, platform)
  if (!api || permission !== "default" || !request) return Promise.resolve(permission)
  return api.requestPermission().catch(() => getNotificationPermission(api, platform))
}
