import { isRecord, AuthFailure } from "../../shared/auth"
import type {
  AppSettings,
  NotificationSettings,
  ShortcutSettings,
  ThemePreference,
} from "../../shared/desktop"
import { AppConfigStore, type AppConfig } from "./app-config-store"

export class AppSettingsManager {
  constructor(
    private readonly configStore: AppConfigStore,
    private readonly getConfig: () => AppConfig,
    private readonly setConfig: (config: AppConfig) => void,
  ) {}

  get(): AppSettings {
    const config = this.getConfig()
    return {
      theme: config.theme,
      shortcuts: { ...config.shortcuts },
      notifications: { ...config.notifications },
    }
  }

  async setTheme(theme: ThemePreference) {
    if (!["light", "dark", "system"].includes(theme)) {
      throw new AuthFailure("invalid_theme", "主题设置不受支持")
    }
    const current = this.getConfig()
    if (theme === current.theme) return null
    await this.save({ ...current, theme })
    return null
  }

  async setNotifications(settings: NotificationSettings) {
    if (
      !isRecord(settings) ||
      typeof settings.soundEnabled !== "boolean" ||
      typeof settings.desktopEnabled !== "boolean" ||
      typeof settings.showMessagePreview !== "boolean"
    ) {
      throw new AuthFailure("invalid_notification_settings", "通知设置不正确")
    }
    await this.save({
      ...this.getConfig(),
      notifications: {
        soundEnabled: settings.soundEnabled,
        desktopEnabled: settings.desktopEnabled,
        showMessagePreview: settings.showMessagePreview,
      },
    })
    return null
  }

  async setShortcuts(shortcuts: ShortcutSettings) {
    if (
      !isRecord(shortcuts) ||
      typeof shortcuts.showWindow !== "string" ||
      typeof shortcuts.screenshot !== "string" ||
      typeof shortcuts.search !== "string" ||
      shortcuts.showWindow.length > 64 ||
      shortcuts.screenshot.length > 64 ||
      shortcuts.search.length > 64
    ) {
      throw new AuthFailure("invalid_shortcut", "快捷键设置不正确")
    }
    await this.save({ ...this.getConfig(), shortcuts: { ...shortcuts } })
    return null
  }

  private async save(config: AppConfig) {
    await this.configStore.save(config)
    this.setConfig(config)
  }
}
