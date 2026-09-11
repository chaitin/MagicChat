const browserMessageNotificationStorageKey =
  "client-web:browser-message-notification-enabled"
const messageNotificationSoundStorageKey =
  "client-web:message-notification-sound-enabled"
let fallbackBrowserMessageNotificationEnabled = true
let fallbackMessageNotificationSoundEnabled = true

export function isBrowserMessageNotificationEnabled() {
  if (typeof window === "undefined") {
    return fallbackBrowserMessageNotificationEnabled
  }

  try {
    return (
      window.localStorage.getItem(browserMessageNotificationStorageKey) !==
      "false"
    )
  } catch {
    return fallbackBrowserMessageNotificationEnabled
  }
}

export function setBrowserMessageNotificationEnabled(enabled: boolean) {
  fallbackBrowserMessageNotificationEnabled = enabled
  if (typeof window === "undefined") {
    return
  }

  try {
    window.localStorage.setItem(
      browserMessageNotificationStorageKey,
      String(enabled)
    )
  } catch {
    // Keep the in-memory setting usable when browser storage is unavailable.
  }
}

export function isMessageNotificationSoundEnabled() {
  if (typeof window === "undefined") {
    return fallbackMessageNotificationSoundEnabled
  }

  try {
    const stored = window.localStorage.getItem(
      messageNotificationSoundStorageKey
    )
    return stored !== "false"
  } catch {
    return fallbackMessageNotificationSoundEnabled
  }
}

export function setMessageNotificationSoundEnabled(enabled: boolean) {
  fallbackMessageNotificationSoundEnabled = enabled
  if (typeof window === "undefined") {
    return
  }

  try {
    window.localStorage.setItem(
      messageNotificationSoundStorageKey,
      String(enabled)
    )
  } catch {
    // Keep the in-memory setting usable when browser storage is unavailable.
  }
}
