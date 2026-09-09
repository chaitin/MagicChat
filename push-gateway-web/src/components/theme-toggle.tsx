import { SunMoonIcon } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const handleClick = () => {
    setTheme(isDark ? "light" : "dark")
  }

  return (
    <Button
      aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
      onClick={handleClick}
      size="icon-sm"
      variant="outline"
    >
      <SunMoonIcon />
      <span className="sr-only">
        {isDark ? "切换到浅色模式" : "切换到深色模式"}
      </span>
    </Button>
  )
}
