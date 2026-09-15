import { useEffect, useState } from "react"
import { AnimatedToastProvider } from "@/components/motion/animated-toast-provider"
import { LoginPage } from "@/features/auth/login-page"
import type { ThemePreference } from "../shared/desktop"

export type Theme = ThemePreference

type ResolvedTheme = Exclude<Theme, "system">

export function App() {
  const [theme, setTheme] = useState<Theme>("system")
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  )

  useEffect(() => {
    let cancelled = false
    void window.desktop?.getAppSettings().then((result) => {
      if (!cancelled && result.ok) setTheme(result.data.theme)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const update = () => setSystemTheme(media.matches ? "dark" : "light")
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  function changeTheme(nextTheme: Theme) {
    const previousTheme = theme
    setTheme(nextTheme)
    const persistence = window.desktop?.setTheme(nextTheme)
    if (!persistence) return
    void persistence
      .then((result) => {
        if (!result.ok) setTheme((current) => (current === nextTheme ? previousTheme : current))
      })
      .catch(() => {
        setTheme((current) => (current === nextTheme ? previousTheme : current))
      })
  }

  const resolvedTheme = theme === "system" ? systemTheme : theme

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark")
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  return (
    <AnimatedToastProvider>
      <div className="app-shell">
        <LoginPage theme={theme} resolvedTheme={resolvedTheme} onThemeChange={changeTheme} />
      </div>
    </AnimatedToastProvider>
  )
}
