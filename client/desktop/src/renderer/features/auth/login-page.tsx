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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ServerSelectPage } from "./server-select-page"
import { SigningInPage } from "./signing-in-page"
import { ChatPage } from "../chat/chat-page"
import { useConnection } from "./use-connection"
import type { ThemePreference } from "../../../shared/desktop"

export function LoginPage({
  theme,
  resolvedTheme,
  onThemeChange,
  onOrganizationNameChange,
}: {
  theme: ThemePreference
  resolvedTheme: Exclude<ThemePreference, "system">
  onThemeChange: (theme: ThemePreference) => void
  onOrganizationNameChange: (name: string) => void
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
  const [quitOpen, setQuitOpen] = useState(false)
  const [quitPending, setQuitPending] = useState(false)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [supportsWebGL] = useState(() => {
    try {
      const context = document.createElement("canvas").getContext("webgl2")
      context?.getExtension("WEBGL_lose_context")?.loseContext()
      return Boolean(context)
    } catch {
      return false
    }
  })
  const [notificationTarget, setNotificationTarget] = useState<{
    targetId: string
    conversationId: string
    messageId: string
  } | null>(null)
  const enterChat = useCallback(() => {
    setRefreshingAll(false)
    setScreen("chat")
  }, [])
  const handleInitializationFailure = useCallback(
    (problem: { code: string; message: string }) => {
      setRefreshingAll(false)
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
  useEffect(() => window.desktop?.onRequestQuit(() => setQuitOpen(true)), [])
  useEffect(
    () => window.desktop?.onOpenMessageNotification((event) => setNotificationTarget(event)),
    [],
  )

  useEffect(() => {
    onOrganizationNameChange(connection?.user ? connection.info.organizationName : "")
  }, [connection?.info.organizationName, connection?.user, onOrganizationNameChange])

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

  async function confirmQuit() {
    if (quitPending || !window.desktop) return
    setQuitPending(true)
    try {
      await window.desktop.windowControls.quit()
    } catch {
      setQuitPending(false)
      showToast({ status: "error", title: "无法关闭即应，请稍后重试" })
    }
  }

  const quitConfirmDialog = (
    <AlertDialog
      open={quitOpen}
      onOpenChange={(open) => {
        if (!quitPending) setQuitOpen(open)
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>确认关闭即应</AlertDialogTitle>
          <AlertDialogDescription>即应将停止运行，确认要关闭吗？</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={quitPending}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={quitPending}
            onClick={(event) => {
              event.preventDefault()
              void confirmQuit()
            }}
          >
            {quitPending ? (
              <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />
            ) : null}
            关闭即应
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

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
        <AuthBackground theme={resolvedTheme} supportsWebGL={supportsWebGL}>
          <SigningInPage loadingOnly />
        </AuthBackground>
        {traySettingsDialog}
        {quitConfirmDialog}
      </>
    )
  }

  if (screen === "chat") {
    return (
      <>
        <ChatPage
          targetId={connection?.targetId ?? ""}
          serverUrl={connection?.server.url ?? ""}
          userId={connection?.user?.id ?? ""}
          userName={connection?.user?.name ?? "我"}
          userEmail={connection?.user?.email ?? ""}
          resolvedTheme={resolvedTheme}
          theme={theme}
          catalog={catalog}
          isPreview={isPreview}
          onThemeChange={onThemeChange}
          onSignOut={handleSignOut}
          onRequestQuit={() => setQuitOpen(true)}
          onCatalogChange={acceptCatalog}
          onRefresh={() => {
            setRefreshingAll(true)
            setScreen("signing-in")
          }}
          notificationTarget={
            notificationTarget?.targetId === connection?.targetId ? notificationTarget : null
          }
          onNotificationHandled={() => setNotificationTarget(null)}
        />
        {traySettingsDialog}
        {quitConfirmDialog}
      </>
    )
  }

  if (screen === "servers") {
    return (
      <>
        <AuthBackground theme={resolvedTheme} supportsWebGL={supportsWebGL}>
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
        {quitConfirmDialog}
      </>
    )
  }

  if (screen === "signing-in") {
    return (
      <>
        <AuthBackground theme={resolvedTheme} supportsWebGL={supportsWebGL}>
          <SigningInPage
            targetId={connection?.targetId ?? ""}
            refreshAll={refreshingAll}
            onComplete={enterChat}
            onFailure={handleInitializationFailure}
          />
        </AuthBackground>
        {traySettingsDialog}
        {quitConfirmDialog}
      </>
    )
  }

  return (
    <>
      <AuthBackground theme={resolvedTheme} supportsWebGL={supportsWebGL}>
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
      {quitConfirmDialog}
    </>
  )
}

function AuthBackground({
  children,
  theme,
  supportsWebGL,
}: {
  children: ReactNode
  theme: Exclude<ThemePreference, "system">
  supportsWebGL: boolean
}) {
  return (
    <div className="relative isolate h-full overflow-hidden bg-background">
      {supportsWebGL ? (
        <ShaderBackground
          variant="water"
          speed={1}
          colorBack={theme === "dark" ? "#111111" : "#ededed"}
          colorHighlight={theme === "dark" ? "#2c2c2c" : "#ffffff"}
          className="pointer-events-none absolute inset-0 z-0"
          aria-hidden
        />
      ) : (
        <div className="auth-background-fallback" data-theme={theme} aria-hidden />
      )}
      <div className="relative z-10 h-full">{children}</div>
    </div>
  )
}
