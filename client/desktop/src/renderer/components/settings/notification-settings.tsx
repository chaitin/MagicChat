import { useEffect, useState } from "react"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { Switch } from "@/components/motion/switch"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings as NotificationPreferences,
} from "../../../shared/desktop"

export function NotificationSettings({ disabled }: { disabled: boolean }) {
  const { showToast } = useAnimatedToast()
  const [settings, setSettings] = useState(DEFAULT_NOTIFICATION_SETTINGS)
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
        <NotificationSettingItem
          title="显示消息内容"
          description="在桌面通知中显示发送人和消息摘要，关闭后仅提示收到新消息"
          checked={settings.showMessagePreview}
          disabled={switchDisabled || !settings.desktopEnabled}
          onCheckedChange={(checked) => void update({ ...settings, showMessagePreview: checked })}
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
          size="sm"
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          ariaLabel={title}
        />
      </ItemActions>
    </Item>
  )
}
