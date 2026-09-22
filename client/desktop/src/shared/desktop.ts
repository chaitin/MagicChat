import type { AccountDataBridge } from "./account-data"
import type { AuthBridge, AuthResult } from "./auth"
import type { MediaBridge } from "./media"

export type ThemePreference = "light" | "dark" | "system"
export type DesktopPlatform = "windows" | "macos" | "linux"
export type ShortcutSettings = {
  showWindow: string
  screenshot: string
  search: string
}
export const DEFAULT_SHORTCUTS: ShortcutSettings = {
  showWindow: "Alt+J",
  screenshot: "Alt+Shift+A",
  search: "CommandOrControl+F",
}
export type NotificationSettings = {
  soundEnabled: boolean
  desktopEnabled: boolean
}
export type AppSettings = {
  theme: ThemePreference
  shortcuts: ShortcutSettings
  notifications: NotificationSettings
}

export const JIYING_HOMEPAGE = "https://jiying.chat/"
export const MAGICCHAT_REPOSITORY = "https://github.com/chaitin/MagicChat"
export const MAGICCHAT_APP_DEVELOPMENT = `${MAGICCHAT_REPOSITORY}/blob/main/APPLICATION_DEVELOPMENT.md`
export const EXTERNAL_LINKS = [
  JIYING_HOMEPAGE,
  "https://chaitin.cn/",
  "https://baizhi.cloud/",
  MAGICCHAT_REPOSITORY,
  MAGICCHAT_APP_DEVELOPMENT,
] as const

export type ReleasePlatform = "windows" | "macos" | "linux-amd" | "linux-arm"
export type UpdateInfo = {
  platform: ReleasePlatform
  currentVersion: string
  currentBuildId: number
  latestVersion: string
  latestBuildId: number
  downloadUrl: string
  updateAvailable: boolean
}

export type StorageInfo = {
  directoryPath: string
}
export type StorageUsage = {
  bytes: number
}

export type SystemInfo = {
  type: "Windows" | "macOS" | "Linux"
  version: string
  architecture: string
}

export const DESKTOP_CHANNELS = {
  openHomepage: "desktop-next:v1:open-homepage",
  openExternalLink: "desktop-next:v1:open-external-link",
  openWebLink: "desktop-next:v1:open-web-link",
  copyText: "desktop-next:v1:clipboard-copy-text",
  checkForUpdates: "desktop-next:v1:check-for-updates",
  getSystemInfo: "desktop-next:v1:get-system-info",
  getStorageInfo: "desktop-next:v1:get-storage-info",
  openStorageDirectory: "desktop-next:v1:open-storage-directory",
  calculateStorageUsage: "desktop-next:v1:calculate-storage-usage",
  getAppSettings: "desktop-next:v1:get-app-settings",
  setTheme: "desktop-next:v1:set-theme",
  setNotificationSettings: "desktop-next:v1:set-notification-settings",
  setShortcutSettings: "desktop-next:v1:set-shortcut-settings",
  setShortcutRecording: "desktop-next:v1:set-shortcut-recording",
  openSettings: "desktop-next:v1:open-settings",
  requestSignOut: "desktop-next:v1:request-sign-out",
  requestQuit: "desktop-next:v1:request-quit",
  windowQuit: "desktop-next:v1:window-quit",
  windowGetState: "desktop-next:v1:window-get-state",
  windowMinimize: "desktop-next:v1:window-minimize",
  windowToggleMaximize: "desktop-next:v1:window-toggle-maximize",
  windowClose: "desktop-next:v1:window-close",
  windowMaximizedChanged: "desktop-next:v1:window-maximized-changed",
} as const

export function isSafeWebUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 2048) return false
  try {
    const url = new URL(value)
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

export interface DesktopBridge {
  readonly auth: AuthBridge
  readonly accountData: AccountDataBridge
  readonly media: MediaBridge
  openHomepage(): Promise<AuthResult<null>>
  openExternalLink(url: string): Promise<AuthResult<null>>
  openWebLink(url: string): Promise<AuthResult<null>>
  copyText(text: string): Promise<AuthResult<null>>
  checkForUpdates(): Promise<AuthResult<UpdateInfo>>
  getSystemInfo(): Promise<AuthResult<SystemInfo>>
  getStorageInfo(): Promise<AuthResult<StorageInfo>>
  openStorageDirectory(): Promise<AuthResult<null>>
  calculateStorageUsage(): Promise<AuthResult<StorageUsage>>
  getAppSettings(): Promise<AuthResult<AppSettings>>
  setTheme(theme: ThemePreference): Promise<AuthResult<null>>
  setNotificationSettings(settings: NotificationSettings): Promise<AuthResult<null>>
  setShortcutSettings(settings: ShortcutSettings): Promise<AuthResult<null>>
  setShortcutRecording(recording: boolean): Promise<AuthResult<null>>
  onOpenSettings(callback: () => void): () => void
  onRequestSignOut(callback: () => void): () => void
  onRequestQuit(callback: () => void): () => void
  readonly windowControls: {
    readonly platform: DesktopPlatform
    getMaximized(): Promise<boolean>
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    quit(): Promise<void>
    onMaximizedChange(callback: (maximized: boolean) => void): () => void
  }
}
