import { useEffect, useState } from "react"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { Switch } from "@/components/ui/switch"
import type { NotificationSettings as NotificationPreferences } from "../../../shared/desktop"

const defaults: NotificationPreferences = {
  soundEnabled: true,
  desktopEnabled: true,
}

export function NotificationSettings({ disabled }: { disabled: boolean }) {
  const { showToast } = useAnimatedToast()
  const [settings, setSettings] = useState(defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!window.desktop) {
      setLoading(false)
      return
    }
    void window.desktop
      .getAppSettings()
      .then((result) => {
        if (!cancelled && result.ok) setSettings(result.data.notifications)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function update(next: NotificationPreferences) {
    if (!window.desktop || saving) return
    const previous = settings
    setSettings(next)
    setSaving(true)
    try {
      const result = await window.desktop.setNotificationSettings(next)
      if (!result.ok) {
        setSettings(previous)
        showToast({
          status: "error",
          title: "无法保存通知设置",
          description: result.error.message,
        })
      }
    } catch {
      setSettings(previous)
      showToast({ status: "error", title: "无法保存通知设置，请稍后重试" })
    } finally {
      setSaving(false)
    }
  }

  const switchDisabled = disabled || loading || saving
  return (
    <section aria-label="通知设置">
      <ItemGroup className="gap-3">
        <NotificationSettingItem
          title="通知铃声"
          description="收到新消息时播放提示音"
          checked={settings.soundEnabled}
          disabled={switchDisabled}
          onCheckedChange={(checked) => void update({ ...settings, soundEnabled: checked })}
        />
        <NotificationSettingItem
          title="桌面通知"
          description="收到新消息时显示系统桌面通知"
          checked={settings.desktopEnabled}
          disabled={switchDisabled}
          onCheckedChange={(checked) => void update({ ...settings, desktopEnabled: checked })}
        />
      </ItemGroup>
    </section>
  )
}

function NotificationSettingItem({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string
  description: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <Item variant="outline" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0">
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-label={title}
        />
      </ItemActions>
    </Item>
  )
}
