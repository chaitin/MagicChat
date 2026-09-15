import { useEffect, useState } from "react"
import { AnimatedToastProvider } from "@/components/motion/animated-toast-provider"
import { LoginPage } from "@/features/auth/login-page"

export type Theme = "light" | "dark" | "system"

type ResolvedTheme = Exclude<Theme, "system">

export function App() {
  const [theme, setTheme] = useState<Theme>("system")
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  )

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const update = () => setSystemTheme(media.matches ? "dark" : "light")
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  const resolvedTheme = theme === "system" ? systemTheme : theme

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark")
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  return (
    <AnimatedToastProvider>
      <div className="app-shell">
        <LoginPage theme={theme} onThemeChange={setTheme} />
      </div>
    </AnimatedToastProvider>
  )
}
