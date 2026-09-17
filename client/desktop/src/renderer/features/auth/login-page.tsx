import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
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
import { ChatPage } from "../chat/chat-page"
import { useConnection } from "./use-connection"
import type { ThemePreference } from "../../../shared/desktop"

export function LoginPage({
  theme,
  resolvedTheme,
  onThemeChange,
}: {
  theme: ThemePreference
  resolvedTheme: Exclude<ThemePreference, "system">
  onThemeChange: (theme: ThemePreference) => void
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
  const [screen, setScreen] = useState<"startup" | "servers" | "login" | "signing-in" | "chat">(
    "startup",
  )
  const shownConnectionError = useRef("")
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const enterChat = useCallback(() => setScreen("chat"), [])
  const handleInitializationFailure = useCallback(
    (problem: { code: string; message: string }) => {
      if (connection) accept({ ...connection, user: null })
      setScreen("servers")
      showToast({ status: "error", title: "账号初始化失败", description: problem.message })
    },
    [accept, connection, showToast],
  )
  const handleSignOut = useCallback(async () => {
    if (!connection || !window.desktop) return false
    try {
      const result = await window.desktop.auth.signOut(connection.targetId)
      if (!result.ok) {
        showToast({ status: "error", title: "退出登录失败", description: result.error.message })
        return false
      }
      accept({ ...connection, user: null })
      setScreen("login")
      return true
    } catch {
      showToast({ status: "error", title: "退出登录失败", description: "请稍后重试" })
      return false
    }
  }, [accept, connection, showToast])

  useEffect(() => window.desktop?.onOpenSettings(() => setSettingsOpen(true)), [])

  useEffect(() => {
    if (!connection?.targetId || !window.desktop) return
    return window.desktop.accountData.onSyncStateChange((event) => {
      if (event.targetId !== connection.targetId || event.state !== "loading") return
      setScreen((current) => (current === "chat" ? "signing-in" : current))
    })
  }, [connection?.targetId])

  useEffect(() => {
    if (screen !== "startup" || loading) return
    setScreen(connection?.user ? "signing-in" : "servers")
  }, [connection?.user, loading, screen])

  useEffect(() => {
    if (screen !== "login" || !error || shownConnectionError.current === error.message) return
    shownConnectionError.current = error.message
    showToast({ status: "error", title: "无法连接服务器", description: error.message })
  }, [error, screen, showToast])

  const traySettingsDialog = (
    <SettingsDialog
      theme={theme}
      catalog={catalog}
      disabled={busy || isPreview}
      onThemeChange={onThemeChange}
      onCatalogChange={acceptCatalog}
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
      trigger={null}
    />
  )

  if (screen === "startup") {
    return (
      <>
        <AuthBackground theme={resolvedTheme}>
          <SigningInPage loadingOnly />
        </AuthBackground>
        {traySettingsDialog}
      </>
    )
  }

  if (screen === "chat") {
    return (
      <>
        <ChatPage
          targetId={connection?.targetId ?? ""}
          userId={connection?.user?.id ?? ""}
          userName={connection?.user?.name ?? "我"}
          userEmail={connection?.user?.email ?? ""}
          resolvedTheme={resolvedTheme}
          theme={theme}
          catalog={catalog}
          isPreview={isPreview}
          onThemeChange={onThemeChange}
          onSignOut={handleSignOut}
          onCatalogChange={acceptCatalog}
        />
        {traySettingsDialog}
      </>
    )
  }

  if (screen === "servers") {
    return (
      <>
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
        {traySettingsDialog}
      </>
    )
  }

  if (screen === "signing-in") {
    return (
      <>
        <AuthBackground theme={resolvedTheme}>
          <SigningInPage
            targetId={connection?.targetId ?? ""}
            onComplete={enterChat}
            onFailure={handleInitializationFailure}
          />
        </AuthBackground>
        {traySettingsDialog}
      </>
    )
  }

  return (
    <>
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
                    onSignedIn={({ user, savedLogin }) => {
                      accept({
                        ...connection,
                        user,
                        savedLogin: savedLogin ?? connection.savedLogin,
                      })
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
      {traySettingsDialog}
    </>
  )
}

function AuthBackground({
  children,
  theme,
}: {
  children: ReactNode
  theme: Exclude<ThemePreference, "system">
}) {
  return (
    <div className="relative isolate h-full overflow-hidden bg-background">
      <ShaderBackground
        variant="water"
        speed={1}
        colorBack={theme === "dark" ? "#111111" : "#ededed"}
        colorHighlight={theme === "dark" ? "#2c2c2c" : "#ffffff"}
        className="pointer-events-none absolute inset-0 z-0"
        aria-hidden
      />
      <div className="relative z-10 h-full">{children}</div>
    </div>
  )
}
