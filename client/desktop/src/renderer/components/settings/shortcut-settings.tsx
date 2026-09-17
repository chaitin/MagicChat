import { useEffect, useState } from "react"
import { Button as BeButton } from "@/components/motion/button/base"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { DEFAULT_SHORTCUTS, type ShortcutSettings } from "../../../shared/desktop"

type ShortcutAction = keyof ShortcutSettings

export function ShortcutSettingsPage({ disabled }: { disabled: boolean }) {
  const { showToast } = useAnimatedToast()
  const [settings, setSettings] = useState<ShortcutSettings>(DEFAULT_SHORTCUTS)
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.desktop?.getAppSettings().then((result) => {
      if (!cancelled && result.ok) setSettings(result.data.shortcuts)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!recording) return
    const stopRecording = () => {
      setRecording(null)
      void window.desktop?.setShortcutRecording(false)
    }
    const capture = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === "Escape") {
        stopRecording()
        return
      }
      const accelerator = keyboardEventToAccelerator(event)
      if (!accelerator) return
      const action = recording
      const next = { ...settings, [action]: accelerator }
      setSaving(true)
      void window.desktop
        ?.setShortcutSettings(next)
        .then((result) => {
          if (result.ok) setSettings(next)
          else {
            showToast({
              status: "error",
              title: "无法保存快捷键",
              description: result.error.message,
            })
          }
        })
        .catch(() => {
          showToast({ status: "error", title: "无法保存快捷键，请稍后重试" })
        })
        .finally(() => {
          setSaving(false)
          stopRecording()
        })
    }
    window.addEventListener("keydown", capture, true)
    window.addEventListener("blur", stopRecording)
    return () => {
      window.removeEventListener("keydown", capture, true)
      window.removeEventListener("blur", stopRecording)
      void window.desktop?.setShortcutRecording(false)
    }
  }, [recording, settings, showToast])

  async function beginRecording(action: ShortcutAction) {
    if (!window.desktop || disabled || saving) return
    try {
      const result = await window.desktop.setShortcutRecording(true)
      if (!result.ok) {
        showToast({
          status: "error",
          title: "无法修改快捷键",
          description: result.error.message,
        })
        return
      }
      setRecording(action)
    } catch {
      showToast({ status: "error", title: "无法修改快捷键，请稍后重试" })
    }
  }

  return (
    <section aria-label="快捷键设置">
      <ItemGroup className="gap-3">
        <ShortcutItem
          title="唤出即应窗口"
          description="窗口关闭时打开，已打开时移至最前面"
          shortcut={settings.showWindow}
          recording={recording === "showWindow"}
          disabled={disabled || saving}
          onRecord={() => void beginRecording("showWindow")}
        />
        <ShortcutItem
          title="截图"
          description="选择屏幕区域并复制到剪贴板"
          shortcut={settings.screenshot}
          recording={recording === "screenshot"}
          disabled={disabled || saving}
          onRecord={() => void beginRecording("screenshot")}
        />
      </ItemGroup>
    </section>
  )
}

function ShortcutItem({
  title,
  description,
  shortcut,
  recording,
  disabled,
  onRecord,
}: {
  title: string
  description: string
  shortcut: string
  recording: boolean
  disabled: boolean
  onRecord: () => void
}) {
  return (
    <Item variant="outline" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0">
        <BeButton
          type="button"
          variant={recording ? "primary" : "outline"}
          size="sm"
          disabled={disabled}
          onClick={onRecord}
        >
          {recording ? "请按快捷键" : formatShortcut(shortcut)}
        </BeButton>
      </ItemActions>
    </Item>
  )
}

function keyboardEventToAccelerator(event: KeyboardEvent): string | null {
  if (["Alt", "Shift", "Control", "Meta"].includes(event.key)) return null
  const modifiers = [
    event.ctrlKey ? "Control" : "",
    event.metaKey ? "Command" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
  ].filter(Boolean)
  if (modifiers.length === 0) return null
  const key = acceleratorKey(event)
  return key ? [...modifiers, key].join("+") : null
}

function acceleratorKey(event: KeyboardEvent): string | null {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.key)) return event.key
  const keys: Record<string, string> = {
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Space: "Space",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
  }
  return keys[event.key] ?? null
}

function formatShortcut(shortcut: string): string {
  return shortcut.split("+").join(" + ")
}
