import { useEffect, useState } from "react"
import { DEFAULT_SHORTCUTS, type ShortcutSettings } from "../../shared/desktop"
export { formatKeyboardShortcut, matchesKeyboardShortcut } from "../../shared/keyboard-shortcut"

const shortcutsChangedEvent = "jiying:shortcuts-changed"

export function useAppShortcuts() {
  const [shortcuts, setShortcuts] = useState<ShortcutSettings>(DEFAULT_SHORTCUTS)

  useEffect(() => {
    let cancelled = false
    void window.desktop?.getAppSettings().then((result) => {
      if (!cancelled && result.ok) setShortcuts(result.data.shortcuts)
    })
    const update = (event: Event) => {
      setShortcuts((event as CustomEvent<ShortcutSettings>).detail)
    }
    window.addEventListener(shortcutsChangedEvent, update)
    return () => {
      cancelled = true
      window.removeEventListener(shortcutsChangedEvent, update)
    }
  }, [])

  return shortcuts
}

export function notifyAppShortcutsChanged(shortcuts: ShortcutSettings) {
  window.dispatchEvent(new CustomEvent(shortcutsChangedEvent, { detail: shortcuts }))
}
