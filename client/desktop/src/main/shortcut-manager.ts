import { globalShortcut } from "electron"
import { DEFAULT_SHORTCUTS, type ShortcutSettings } from "../shared/desktop"
import { AuthFailure } from "../shared/auth"

export class ShortcutManager {
  private settings: ShortcutSettings = { ...DEFAULT_SHORTCUTS }
  private suspended = false

  constructor(
    private readonly showWindow: () => void,
    private readonly takeScreenshot: () => Promise<void>,
  ) {}

  update(settings: ShortcutSettings) {
    validateShortcutSettings(settings)
    const previous = this.settings
    globalShortcut.unregisterAll()
    if (!this.register(settings)) {
      globalShortcut.unregisterAll()
      if (!this.suspended) this.register(previous)
      throw new AuthFailure("shortcut_unavailable", "快捷键已被其他应用占用")
    }
    this.settings = { ...settings }
    if (this.suspended) globalShortcut.unregisterAll()
  }

  setRecording(recording: boolean) {
    if (recording === this.suspended) return
    this.suspended = recording
    globalShortcut.unregisterAll()
    if (!recording && !this.register(this.settings)) {
      globalShortcut.unregisterAll()
      throw new AuthFailure("shortcut_unavailable", "快捷键已被其他应用占用")
    }
  }

  getSettings(): ShortcutSettings {
    return { ...this.settings }
  }

  close() {
    globalShortcut.unregisterAll()
  }

  private register(settings: ShortcutSettings): boolean {
    const showWindowRegistered = globalShortcut.register(settings.showWindow, this.showWindow)
    if (!showWindowRegistered) return false
    const screenshotRegistered = globalShortcut.register(settings.screenshot, () => {
      void this.takeScreenshot().catch((error: unknown) => {
        console.warn("无法启动截图工具", error)
      })
    })
    if (!screenshotRegistered) globalShortcut.unregister(settings.showWindow)
    return screenshotRegistered
  }
}

function validateShortcutSettings(settings: ShortcutSettings) {
  if (
    !settings ||
    typeof settings.showWindow !== "string" ||
    typeof settings.screenshot !== "string" ||
    !validAccelerator(settings.showWindow) ||
    !validAccelerator(settings.screenshot)
  ) {
    throw new AuthFailure("invalid_shortcut", "快捷键格式不正确")
  }
  if (normalize(settings.showWindow) === normalize(settings.screenshot)) {
    throw new AuthFailure("duplicate_shortcut", "两个功能不能使用相同的快捷键")
  }
}

function validAccelerator(accelerator: string): boolean {
  if (!accelerator || accelerator.length > 64) return false
  const parts = accelerator.split("+")
  const modifiers = new Set(["alt", "shift", "control", "command", "commandorcontrol", "super"])
  const modifierCount = parts.filter((part) => modifiers.has(part.toLowerCase())).length
  return modifierCount >= 1 && modifierCount === parts.length - 1 && parts.every(Boolean)
}

function normalize(accelerator: string): string {
  return accelerator.toLowerCase().replaceAll(" ", "")
}
