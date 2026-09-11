import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const colorGroups = [
  {
    title: "背景与表面",
    description: "页面、分组、内容容器和深色浮层使用的基础背景。",
    colors: [
      ["--weui-bg-0", "页面背景"],
      ["--weui-bg-1", "次级背景"],
      ["--weui-bg-2", "内容表面"],
      ["--weui-bg-3", "辅助表面"],
      ["--weui-bg-4", "深色表面"],
      ["--weui-bg-5", "补充表面"],
    ],
  },
  {
    title: "文字与图标",
    description: "通过黑白透明度形成稳定的内容层级。",
    colors: [
      ["--weui-fg-0", "主文字"],
      ["--weui-fg-0-5", "次主文字"],
      ["--weui-fg-1", "次要文字"],
      ["--weui-fg-2", "提示文字"],
      ["--weui-fg-3", "弱分隔"],
      ["--weui-fg-4", "加强分隔"],
      ["--weui-fg-half", "半强调文字"],
      ["--weui-glyph-0", "主图标"],
      ["--weui-glyph-1", "次要图标"],
      ["--weui-glyph-2", "弱图标"],
    ],
  },
  {
    title: "品牌色",
    description: "编号从 1 到 5 代表视觉强调程度由弱到强。",
    colors: [
      ["--weui-brand-1", "品牌色 1 · 最弱背景"],
      ["--weui-brand-2", "品牌色 2 · 柔和状态"],
      ["--weui-brand-3", "品牌色 3 · 基准色"],
      ["--weui-brand-4", "品牌色 4 · 强调状态"],
      ["--weui-brand-5", "品牌色 5 · 最强状态"],
      ["--weui-brand", "品牌主色别名"],
      ["--weui-text-green", "绿色文字"],
    ],
  },
  {
    title: "功能与状态色",
    description: "链接、信息、成功、警告、错误等业务状态使用的颜色。",
    colors: [
      ["--weui-blue", "蓝色"],
      ["--weui-indigo", "靛蓝"],
      ["--weui-purple", "紫色"],
      ["--weui-green", "黄绿色"],
      ["--weui-lightgreen", "浅绿色"],
      ["--weui-orange", "橙色"],
      ["--weui-yellow", "黄色"],
      ["--weui-red", "错误红"],
      ["--weui-orangered", "橙红色"],
      ["--weui-link", "链接色"],
    ],
  },
  {
    title: "交互与遮罩",
    description: "分割线、悬停、按下和模态遮罩使用的透明颜色。",
    colors: [
      ["--weui-secondary-bg", "次级背景"],
      ["--weui-separator-0", "默认分割线"],
      ["--weui-separator-1", "加强分割线"],
      ["--weui-state-hovered", "悬停状态"],
      ["--weui-state-pressed", "按下状态"],
      ["--weui-state-pressed-strengthened", "加强按下状态"],
      ["--weui-overlay", "模态遮罩"],
      ["--weui-overlay-white", "浅色遮罩"],
    ],
  },
  {
    title: "标签色",
    description: "标签文字及其低强度背景色，可以成对使用。",
    colors: [
      ["--weui-tag-text-black", "中性标签文字"],
      ["--weui-tag-background-black", "中性标签背景"],
      ["--weui-tag-text-orange", "橙色标签文字"],
      ["--weui-tag-background-orange", "橙色标签背景"],
      ["--weui-tag-text-green", "绿色标签文字"],
      ["--weui-tag-background-green", "绿色标签背景"],
      ["--weui-tag-text-blue", "蓝色标签文字"],
      ["--weui-tag-background-blue", "蓝色标签背景"],
      ["--weui-tag-text-red", "红色标签文字"],
      ["--weui-tag-background-red", "红色标签背景"],
    ],
  },
] as const

const themeOptions = [
  { icon: SunIcon, label: "亮色", value: "light" },
  { icon: MoonIcon, label: "暗色", value: "dark" },
  { icon: MonitorIcon, label: "跟随系统", value: "system" },
] as const

const allColorNames = colorGroups.flatMap((group) =>
  group.colors.map(([name]) => name)
)

export function DebugColorsPage() {
  const { theme, setTheme } = useTheme()
  const { resolvedTheme, values } = useResolvedColors(allColorNames)

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-xl font-semibold">WeUI 颜色变量</h1>
              <span className="text-sm text-muted-foreground">
                {allColorNames.length} 个颜色
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              当前解析为{resolvedTheme === "dark" ? "暗色" : "亮色"}主题
            </p>
          </div>

          <div
            aria-label="主题配色"
            className="flex gap-1 rounded-lg bg-muted p-1"
          >
            {themeOptions.map((option) => {
              const Icon = option.icon
              const active = theme === option.value

              return (
                <Button
                  aria-pressed={active}
                  className={cn(
                    "gap-1.5",
                    active && "bg-background shadow-xs hover:bg-background"
                  )}
                  key={option.value}
                  onClick={() => setTheme(option.value)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Icon aria-hidden="true" />
                  {option.label}
                </Button>
              )
            })}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-10 px-5 py-8 sm:px-8 sm:py-10">
        {colorGroups.map((group) => (
          <section
            aria-labelledby={`color-group-${group.title}`}
            key={group.title}
          >
            <div className="mb-4">
              <h2
                className="text-base font-semibold"
                id={`color-group-${group.title}`}
              >
                {group.title}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {group.description}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.colors.map(([name, label]) => (
                <ColorCard
                  key={name}
                  label={label}
                  name={name}
                  value={values[name]}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}

function ColorCard({
  label,
  name,
  value,
}: {
  label: string
  name: string
  value?: string
}) {
  return (
    <article className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs">
      <div
        className="relative h-24 border-b"
        style={{
          backgroundColor: "#fff",
          backgroundImage:
            "linear-gradient(45deg, #e5e5e5 25%, transparent 25%), linear-gradient(-45deg, #e5e5e5 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e5e5 75%), linear-gradient(-45deg, transparent 75%, #e5e5e5 75%)",
          backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
          backgroundSize: "12px 12px",
        }}
      >
        <div
          className="absolute inset-0"
          style={{ backgroundColor: `var(${name})` }}
        />
      </div>
      <div className="space-y-1.5 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{label}</span>
          <span
            className="size-2.5 shrink-0 rounded-full border"
            style={{ backgroundColor: `var(${name})` }}
          />
        </div>
        <code
          className="block truncate text-xs text-muted-foreground"
          title={name}
        >
          {name}
        </code>
        <code
          className="block truncate text-xs text-muted-foreground"
          title={value}
        >
          {value || "读取中…"}
        </code>
      </div>
    </article>
  )
}

function useResolvedColors(names: readonly string[]) {
  const stableNames = useMemo(() => [...names], [names])
  const [values, setValues] = useState<Record<string, string>>({})
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("light")

  useEffect(() => {
    const root = document.documentElement

    function updateColors() {
      const styles = window.getComputedStyle(root)
      setValues(
        Object.fromEntries(
          stableNames.map((name) => [
            name,
            styles.getPropertyValue(name).trim(),
          ])
        )
      )
      setResolvedTheme(root.classList.contains("dark") ? "dark" : "light")
    }

    updateColors()
    const observer = new MutationObserver(updateColors)
    observer.observe(root, { attributeFilter: ["class"], attributes: true })

    return () => observer.disconnect()
  }, [stableNames])

  return { resolvedTheme, values }
}
