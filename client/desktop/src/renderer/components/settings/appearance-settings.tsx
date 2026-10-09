import { useEffect, useState } from "react"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import {
  MorphSelect,
  MorphSelectContent,
  MorphSelectItem,
  MorphSelectTrigger,
  MorphSelectValue,
} from "@/components/motion/select-morph"
import {
  DEFAULT_CONTENT_ZOOM,
  isContentZoom,
  type ContentZoom,
  type ThemePreference,
} from "../../../shared/desktop"

export function AppearanceSettings({
  theme,
  onThemeChange,
}: {
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
}) {
  const { showToast } = useAnimatedToast()
  const [zoom, setZoom] = useState<ContentZoom>(DEFAULT_CONTENT_ZOOM)
  const [zoomLoading, setZoomLoading] = useState(true)
  const [zoomSaving, setZoomSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!window.desktop) {
      setZoomLoading(false)
      return
    }
    void window.desktop
      .getAppSettings()
      .then((result) => {
        if (cancelled) return
        if (result.ok) setZoom(result.data.contentZoom)
        else
          showToast({
            status: "error",
            title: "无法读取界面缩放设置",
            description: result.error.message,
          })
      })
      .catch(() => {
        if (!cancelled) showToast({ status: "error", title: "无法读取界面缩放设置" })
      })
      .finally(() => {
        if (!cancelled) setZoomLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [showToast])

  async function changeZoom(value: string) {
    const next = Number(value)
    if (!window.desktop || !isContentZoom(next) || zoomSaving) return
    const previous = zoom
    setZoom(next)
    setZoomSaving(true)
    try {
      const result = await window.desktop.setContentZoom(next)
      if (!result.ok) {
        setZoom(previous)
        showToast({ status: "error", title: "无法保存界面缩放", description: result.error.message })
      }
    } catch {
      setZoom(previous)
      showToast({ status: "error", title: "无法保存界面缩放，请稍后重试" })
    } finally {
      setZoomSaving(false)
    }
  }

  return (
    <section className="space-y-5" aria-label="外观设置">
      <div className="grid grid-cols-[1fr_2fr] items-center gap-4">
        <span className="text-sm font-medium">主题</span>
        <MorphSelect
          value={theme}
          onValueChange={(value) => onThemeChange(value as ThemePreference)}
        >
          <MorphSelectTrigger>
            <MorphSelectValue />
          </MorphSelectTrigger>
          <MorphSelectContent>
            <MorphSelectItem value="light">明亮模式</MorphSelectItem>
            <MorphSelectItem value="dark">黑暗模式</MorphSelectItem>
            <MorphSelectItem value="system">跟随系统</MorphSelectItem>
          </MorphSelectContent>
        </MorphSelect>
      </div>
      <div className="grid grid-cols-[1fr_2fr] items-center gap-4">
        <span className="text-sm font-medium">界面缩放</span>
        <MorphSelect
          value={String(zoom)}
          disabled={zoomLoading || zoomSaving}
          onValueChange={(value) => void changeZoom(value)}
        >
          <MorphSelectTrigger>
            <MorphSelectValue />
          </MorphSelectTrigger>
          <MorphSelectContent>
            <MorphSelectItem value="0.8">很小</MorphSelectItem>
            <MorphSelectItem value="0.9">略小</MorphSelectItem>
            <MorphSelectItem value="1">标准</MorphSelectItem>
            <MorphSelectItem value="1.15">略大</MorphSelectItem>
            <MorphSelectItem value="1.3">很大</MorphSelectItem>
          </MorphSelectContent>
        </MorphSelect>
      </div>
    </section>
  )
}
