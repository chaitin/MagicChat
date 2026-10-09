export type NotificationPermissionApi = {
  readonly permission: NotificationPermission
  requestPermission(): Promise<NotificationPermission>
}

export type NotificationPermissionState = NotificationPermission | "unsupported"

export function getNotificationPermission(
  api: NotificationPermissionApi | undefined,
): NotificationPermissionState {
  return api?.permission ?? "unsupported"
}

export function checkNotificationPermission(
  api: NotificationPermissionApi | undefined,
  request: boolean,
): Promise<NotificationPermissionState> {
  const permission = getNotificationPermission(api)
  if (!api || permission !== "default" || !request) return Promise.resolve(permission)
  return api.requestPermission().catch(() => getNotificationPermission(api))
}
