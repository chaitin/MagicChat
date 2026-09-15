import {
  MorphSelect,
  MorphSelectContent,
  MorphSelectItem,
  MorphSelectTrigger,
  MorphSelectValue,
} from "@/components/motion/select-morph"
import type { ThemePreference } from "../../../shared/desktop"

export function AppearanceSettings({
  theme,
  onThemeChange,
}: {
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
}) {
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
    </section>
  )
}
