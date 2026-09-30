import type { UpdateInfo } from "../shared/desktop"

const dismissedUpdateStorageKey = "desktop-next:dismissed-update-build"

type UpdateStorage = Pick<Storage, "getItem" | "setItem">

export function updateVersionKey(info: Pick<UpdateInfo, "platform" | "latestBuildId">): string {
  return `${info.platform}:${info.latestBuildId}`
}

export function shouldPromptForUpdate(
  info: UpdateInfo,
  manual: boolean,
  dismissedKey: string | null,
): boolean {
  return info.updateAvailable && (manual || dismissedKey !== updateVersionKey(info))
}

export function readDismissedUpdate(storage?: UpdateStorage): string | null {
  try {
    return (storage ?? localStorage).getItem(dismissedUpdateStorageKey)
  } catch {
    return null
  }
}

export function saveDismissedUpdate(info: UpdateInfo, storage?: UpdateStorage): void {
  try {
    ;(storage ?? localStorage).setItem(dismissedUpdateStorageKey, updateVersionKey(info))
  } catch {
    // 在存储不可用时，当前会话仍可通过内存状态暂缓提示。
  }
}
