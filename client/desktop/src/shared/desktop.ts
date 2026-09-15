import type { AuthBridge, AuthResult } from "./auth"

export const JIYING_HOMEPAGE = "https://jiying.chat/"
export const EXTERNAL_LINKS = [
  JIYING_HOMEPAGE,
  "https://chaitin.cn/",
  "https://baizhi.cloud/",
  "https://github.com/chaitin/MagicChat",
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
} as const

export interface DesktopBridge {
  readonly auth: AuthBridge
  openHomepage(): Promise<AuthResult<null>>
  openExternalLink(url: string): Promise<AuthResult<null>>
  checkForUpdates(): Promise<AuthResult<UpdateInfo>>
  getSystemInfo(): Promise<AuthResult<SystemInfo>>
}
