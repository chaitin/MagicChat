export type BrowserNotificationPermission =
  "default" | "denied" | "granted" | "unsupported"

export type BrowserMessageNotificationInput = {
  body: string
  onClick?: () => void
  tag: string
  title: string
}

let lastKnownPermission: BrowserNotificationPermission | null = null

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (!("Notification" in globalThis)) {
    return "unsupported"
  }

  const permission = normalizeBrowserNotificationPermission(
    Notification.permission
  )
  if (permission !== "default") {
    lastKnownPermission = permission
  }

  return lastKnownPermission ?? permission
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (!("Notification" in globalThis)) {
    return "unsupported"
  }

  lastKnownPermission = normalizeBrowserNotificationPermission(
    await Notification.requestPermission()
  )

  return lastKnownPermission
}

export function showBrowserMessageNotification({
  body,
  onClick,
  tag,
  title,
}: BrowserMessageNotificationInput) {
  if (getBrowserNotificationPermission() !== "granted") {
    return false
  }

  let notification: Notification
  try {
    notification = new Notification(title, {
      body,
      tag,
    })
  } catch {
    return false
  }

  if (onClick) {
    notification.onclick = onClick
  }

  return true
}

function normalizeBrowserNotificationPermission(
  permission: NotificationPermission
): BrowserNotificationPermission {
  if (
    permission === "default" ||
    permission === "denied" ||
    permission === "granted"
  ) {
    return permission
  }

  return "default"
}
