import type { AccountDataBridge } from "./account-data"
import type { AuthBridge, AuthResult } from "./auth"

export type ThemePreference = "light" | "dark" | "system"
export type ShortcutSettings = {
  showWindow: string
  screenshot: string
}
export const DEFAULT_SHORTCUTS: ShortcutSettings = {
  showWindow: "Alt+Shift+J",
  screenshot: "Alt+Shift+A",
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
export const EXTERNAL_LINKS = [
  JIYING_HOMEPAGE,
  "https://chaitin.cn/",
  "https://baizhi.cloud/",
  MAGICCHAT_REPOSITORY,
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
} as const

export interface DesktopBridge {
  readonly auth: AuthBridge
  readonly accountData: AccountDataBridge
  openHomepage(): Promise<AuthResult<null>>
  openExternalLink(url: string): Promise<AuthResult<null>>
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
}
