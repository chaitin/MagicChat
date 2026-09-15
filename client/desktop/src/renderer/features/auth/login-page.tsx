import { useEffect, useRef, useState, type ReactNode } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeftRightIcon,
  Loading03Icon,
  RefreshIcon,
  WifiDisconnected01Icon,
} from "@hugeicons/core-free-icons"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { Button as BeButton } from "@/components/motion/button/base"
import { ShaderBackground } from "@/components/motion/shader-background"
import { FieldGroup } from "@/components/ui/field"
import { LoginForm, LoginFrame } from "@/components/login-form"
import { PoweredBy } from "@/components/powered-by"
import { SettingsDialog } from "@/components/settings-dialog"
import { ServerSelectPage } from "./server-select-page"
import { SigningInPage } from "./signing-in-page"
import { useConnection } from "./use-connection"

export function LoginPage({
  theme,
  resolvedTheme,
  onThemeChange,
}: {
  theme: "light" | "dark" | "system"
  resolvedTheme: "light" | "dark"
  onThemeChange: (theme: "light" | "dark" | "system") => void
}) {
  const { showToast } = useAnimatedToast()
  const {
    catalog,
    connection,
    error,
    loading,
    isPreview,
    accept,
    acceptCatalog,
    connect,
    clearError,
    retry,
  } = useConnection()
  const [screen, setScreen] = useState<"servers" | "login" | "signing-in">("servers")
  const shownConnectionError = useRef("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (screen !== "login" || !error || shownConnectionError.current === error.message) return
    shownConnectionError.current = error.message
    showToast({ status: "error", title: "无法连接服务器", description: error.message })
  }, [error, screen, showToast])

  if (screen === "servers") {
    return (
      <AuthBackground theme={resolvedTheme}>
        <ServerSelectPage
          catalog={catalog}
          loading={loading}
          isPreview={isPreview}
          initialError={error?.message}
          theme={theme}
          onThemeChange={onThemeChange}
          onCatalogChange={acceptCatalog}
          onSelect={async (serverId) => {
            const result = await connect(serverId)
            if (result.ok) setScreen(result.data.user ? "signing-in" : "login")
            return result
          }}
        />
      </AuthBackground>
    )
  }

  if (screen === "signing-in" || connection?.user) {
    return (
      <AuthBackground theme={resolvedTheme}>
        <SigningInPage />
      </AuthBackground>
    )
  }

  return (
    <AuthBackground theme={resolvedTheme}>
      <main className="login-page login-page--shader">
        <div className="auth-surface auth-surface--shader grid min-h-full grid-rows-[1fr_auto] gap-4 p-6 text-foreground md:p-10">
          <div className="flex items-center justify-center">
            <div className="flex w-full max-w-sm flex-col gap-3">
              <div className="flex h-8 items-center justify-between gap-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <BeButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-2 rounded-md px-2.5 text-sm text-muted-foreground hover:text-foreground"
                    disabled={busy}
                    onClick={() => {
                      clearError()
                      setScreen("servers")
                    }}
                  >
                    <HugeiconsIcon icon={ArrowLeftRightIcon} className="size-4" aria-hidden />
                    切换服务器
                  </BeButton>
                </div>
                <SettingsDialog
                  theme={theme}
                  catalog={catalog}
                  disabled={busy || isPreview}
                  onThemeChange={onThemeChange}
                  onCatalogChange={acceptCatalog}
                />
              </div>
              {!loading && !error && connection ? (
                <LoginForm
                  key={connection.targetId}
                  connection={connection}
                  isPreview={isPreview}
                  onBusyChange={setBusy}
                  onSignedIn={({ user }) => {
                    accept({ ...connection, user, lastEmail: user.email })
                    setScreen("signing-in")
                  }}
                />
              ) : (
                <LoginFrame heading={`登录到 ${connection?.info.organizationName ?? "服务器"}`}>
                  <section aria-label="账号登录">
                    <FieldGroup>
                      {loading ? (
                        <div
                          role="status"
                          className="flex min-h-64 flex-col items-center justify-center gap-3 text-center"
                        >
                          <HugeiconsIcon
                            icon={Loading03Icon}
                            className="size-6 animate-spin text-muted-foreground"
                            aria-hidden
                          />
                          <h2 className="font-medium">正在连接服务器</h2>
                        </div>
                      ) : error ? (
                        <div
                          role="alert"
                          className="flex min-h-64 flex-col items-center justify-center gap-3 text-center"
                        >
                          <HugeiconsIcon
                            icon={WifiDisconnected01Icon}
                            className="size-6 text-muted-foreground"
                            aria-hidden
                          />
                          <BeButton type="button" variant="outline" onClick={() => void retry()}>
                            <HugeiconsIcon icon={RefreshIcon} aria-hidden />
                            重新连接
                          </BeButton>
                        </div>
                      ) : null}
                    </FieldGroup>
                  </section>
                </LoginFrame>
              )}
            </div>
          </div>
          <PoweredBy />
        </div>
      </main>
    </AuthBackground>
  )
}

function AuthBackground({ children, theme }: { children: ReactNode; theme: "light" | "dark" }) {
  return (
    <div className="relative isolate h-full overflow-hidden bg-background">
      <ShaderBackground
        variant="water"
        speed={1}
        colorBack={theme === "dark" ? "#111111" : "#ededed"}
        colorHighlight={theme === "dark" ? "#2c2c2c" : "#ffffff"}
        className="pointer-events-none fixed inset-0 z-0"
        aria-hidden
      />
      <div className="relative z-10 h-full">{children}</div>
    </div>
  )
}
