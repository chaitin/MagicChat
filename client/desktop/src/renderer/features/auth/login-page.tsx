import { useState, type ReactNode } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeftRightIcon,
  CheckmarkCircle02Icon,
  Layers01Icon,
  Loading03Icon,
  Logout01Icon,
  RefreshIcon,
  WifiDisconnected01Icon,
} from "@hugeicons/core-free-icons"
import { Button as BeButton } from "@/components/motion/button/base"
import { ShaderBackground } from "@/components/motion/shader-background"
import { FieldDescription, FieldGroup } from "@/components/ui/field"
import { LoginForm, LoginFrame } from "@/components/login-form"
import { PoweredBy } from "@/components/powered-by"
import { SettingsDialog } from "@/components/settings-dialog"
import { ServerSelectPage } from "./server-select-page"
import { SigningInPage } from "./signing-in-page"
import { useConnection } from "./use-connection"

export function LoginPage({
  theme,
  onThemeChange,
}: {
  theme: "light" | "dark" | "system"
  onThemeChange: (theme: "light" | "dark" | "system") => void
}) {
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
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [logoutPending, setLogoutPending] = useState(false)

  async function logout() {
    if (!window.desktop || !connection || logoutPending) return
    setLogoutPending(true)
    setNotice("")
    try {
      const result = await window.desktop.auth.signOut(connection.targetId)
      if (!result.ok) {
        setNotice(result.error.message)
        return
      }
      accept({ ...connection, user: null })
      if (result.data.localOnly) setNotice("已清除本机登录状态，但未能确认服务器撤销会话。")
    } catch {
      setNotice("退出登录未完成，请重试。")
    } finally {
      setLogoutPending(false)
    }
  }

  if (screen === "servers") {
    return (
      <AuthBackground>
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
            if (result.ok) setScreen("login")
            return result
          }}
        />
      </AuthBackground>
    )
  }

  if (screen === "signing-in") {
    return (
      <AuthBackground>
        <SigningInPage />
      </AuthBackground>
    )
  }

  return (
    <AuthBackground>
      <main className="login-page login-page--shader">
        <div className="auth-surface auth-surface--shader grid min-h-full grid-rows-[1fr_auto] gap-4 p-6 text-neutral-800 md:p-10">
          <div className="flex items-center justify-center">
            <div className="flex w-full max-w-sm flex-col gap-3">
              <div className="flex h-8 items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <BeButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-2 rounded-md px-2.5 text-sm text-neutral-800"
                    disabled={busy || logoutPending}
                    onClick={() => {
                      clearError()
                      setNotice("")
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
                  disabled={busy || logoutPending || isPreview}
                  onThemeChange={onThemeChange}
                  onCatalogChange={acceptCatalog}
                />
              </div>
              {notice && (
                <p
                  role="status"
                  className="rounded-md border bg-background p-3 text-sm text-muted-foreground"
                >
                  {notice}
                </p>
              )}
              {!loading && !error && connection && !connection.user ? (
                <LoginForm
                  key={connection.targetId}
                  connection={connection}
                  isPreview={isPreview}
                  onBusyChange={setBusy}
                  onSignedIn={({ user, warning }) => {
                    setNotice(warning ?? "")
                    accept({ ...connection, user, lastEmail: user.email })
                    setScreen("signing-in")
                  }}
                />
              ) : (
                <LoginFrame
                  heading={`登录到 ${connection?.info.organizationName ?? "服务器"}`}
                  footer={
                    <FieldDescription className="px-6 text-center text-neutral-900">
                      会话由桌面端管理，不保存密码。
                    </FieldDescription>
                  }
                >
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
                          <FieldDescription>获取登录方式，并检查已有会话。</FieldDescription>
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
                          <h2 className="font-medium">暂时无法连接</h2>
                          <FieldDescription>{error.message}</FieldDescription>
                          <BeButton type="button" variant="outline" onClick={() => void retry()}>
                            <HugeiconsIcon icon={RefreshIcon} aria-hidden />
                            重新连接
                          </BeButton>
                        </div>
                      ) : (
                        connection?.user && (
                          <div className="flex flex-col items-center gap-4 text-center">
                            <div className="flex size-14 items-center justify-center rounded-full bg-muted text-xl font-medium">
                              {Array.from(connection.user.name)[0]}
                            </div>
                            <div className="space-y-1">
                              <h2 className="text-lg font-medium">{connection.user.name}</h2>
                              <FieldDescription>{connection.user.email}</FieldDescription>
                            </div>
                            <p className="flex items-center gap-2 text-sm">
                              <HugeiconsIcon
                                icon={CheckmarkCircle02Icon}
                                className="size-4"
                                aria-hidden
                              />
                              登录成功，会话已建立
                            </p>
                            <div className="w-full space-y-3 rounded-lg border p-4">
                              <HugeiconsIcon
                                icon={Layers01Icon}
                                className="mx-auto size-5 text-muted-foreground"
                                aria-hidden
                              />
                              <h3 className="text-sm font-medium">工作空间正在构建中</h3>
                              <FieldDescription>
                                登录已经就绪，接下来完善会话列表和聊天体验。
                              </FieldDescription>
                            </div>
                            <BeButton
                              type="button"
                              variant="outline"
                              onClick={() => void logout()}
                              disabled={logoutPending}
                            >
                              {logoutPending ? (
                                <HugeiconsIcon
                                  icon={Loading03Icon}
                                  className="animate-spin"
                                  aria-hidden
                                />
                              ) : (
                                <HugeiconsIcon icon={Logout01Icon} aria-hidden />
                              )}
                              {logoutPending ? "正在退出" : "退出登录"}
                            </BeButton>
                          </div>
                        )
                      )}
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

function AuthBackground({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate h-full overflow-hidden bg-neutral-400">
      <ShaderBackground
        variant="water"
        speed={1}
        className="pointer-events-none fixed inset-0 z-0"
        aria-hidden
      />
      <div className="relative z-10 h-full">{children}</div>
    </div>
  )
}
