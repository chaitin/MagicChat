import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  AlertCircleIcon,
  ArrowRight01Icon,
  EnergyIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons"
import { useEffect, useState } from "react"
import { Button as BeButton } from "@/components/motion/button/base"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PoweredBy } from "@/components/powered-by"
import { SettingsDialog } from "@/components/settings-dialog"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import type { AuthResult, Connection, ServerCatalog, ServerCheck } from "../../../shared/auth"

type CheckState = ServerCheck | "checking"
const CHECK_TIMEOUT_MS = 3_500

function unavailableCheck(serverId: string, message: string): ServerCheck {
  return { serverId, status: "unavailable", checkedAt: Date.now(), message }
}

async function checkWithTimeout(serverId: string): Promise<AuthResult<ServerCheck>> {
  const bridge = window.desktop
  if (!bridge) {
    return { ok: false, error: { code: "bridge", message: "桌面服务暂不可用" } }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      bridge.auth.checkServer(serverId),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("server check timeout")), CHECK_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function ServerSelectPage({
  catalog,
  loading,
  isPreview,
  initialError,
  theme,
  onThemeChange,
  onCatalogChange,
  onSelect,
}: {
  catalog: ServerCatalog
  loading: boolean
  isPreview: boolean
  initialError?: string
  theme: "light" | "dark" | "system"
  onThemeChange: (theme: "light" | "dark" | "system") => void
  onCatalogChange: (catalog: ServerCatalog) => void
  onSelect: (serverId: string) => Promise<AuthResult<Connection>>
}) {
  const [selectedId, setSelectedId] = useState("")
  const [problem, setProblem] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [checks, setChecks] = useState<Record<string, CheckState>>({})
  const serverKey = catalog.servers.map((server) => `${server.id}:${server.url}`).join("|")

  useEffect(() => {
    if (loading || !serverKey) return
    let cancelled = false
    const servers = catalog.servers
    setChecks(Object.fromEntries(servers.map((server) => [server.id, "checking" as const])))

    if (isPreview) {
      setChecks(
        Object.fromEntries(
          servers.map((server) => [
            server.id,
            {
              serverId: server.id,
              status: "available",
              checkedAt: Date.now(),
            } satisfies ServerCheck,
          ]),
        ),
      )
      return () => {
        cancelled = true
      }
    }

    for (const server of servers) {
      void checkWithTimeout(server.id)
        .then((result) => {
          if (cancelled) return
          setChecks((value) => ({
            ...value,
            [server.id]: result.ok
              ? result.data
              : unavailableCheck(server.id, result.error.message),
          }))
        })
        .catch(() => {
          if (cancelled) return
          setChecks((value) => ({
            ...value,
            [server.id]: unavailableCheck(server.id, "检测服务器超时"),
          }))
        })
    }

    return () => {
      cancelled = true
    }
  }, [catalog.servers, isPreview, loading, serverKey])

  async function checkOne(serverId: string) {
    setChecks((value) => ({ ...value, [serverId]: "checking" }))
    if (isPreview) {
      setChecks((value) => ({
        ...value,
        [serverId]: { serverId, status: "available", checkedAt: Date.now() },
      }))
      return
    }
    try {
      const result = await checkWithTimeout(serverId)
      setChecks((value) => ({
        ...value,
        [serverId]: result.ok ? result.data : unavailableCheck(serverId, result.error.message),
      }))
    } catch {
      setChecks((value) => ({
        ...value,
        [serverId]: unavailableCheck(serverId, "无法检测服务器"),
      }))
    }
  }

  async function select(serverId: string) {
    if (loading || selectedId) return
    setSelectedId(serverId)
    setProblem("")
    const result = await onSelect(serverId)
    if (!result.ok) setProblem(result.error.message)
    setSelectedId("")
  }

  return (
    <main className="login-page login-page--shader">
      <div className="auth-surface auth-surface--shader grid min-h-full grid-rows-[1fr_auto] gap-4 p-6 text-neutral-800 md:p-10">
        <div className="flex items-center justify-center">
          <div className="flex w-full max-w-sm flex-col gap-3">
            <div className="flex h-8 items-center justify-between text-sm">
              <span
                className="flex select-none items-center gap-2 font-medium"
                data-slot="page-brand"
              >
                <HugeiconsIcon icon={EnergyIcon} className="size-4" aria-hidden />
                即应 Chat
              </span>
              <SettingsDialog
                theme={theme}
                catalog={catalog}
                disabled={Boolean(selectedId) || loading || isPreview}
                onThemeChange={onThemeChange}
                onCatalogChange={onCatalogChange}
              />
            </div>
            <Card className="w-full" data-block="server-select">
              <CardHeader className="text-center">
                <CardTitle className="text-lg" role="heading" aria-level={1}>
                  选择服务器
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {(problem || initialError) && (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
                  >
                    {problem || initialError}
                  </p>
                )}
                <div className="space-y-3">
                  <div className="max-h-72 overflow-y-auto pr-1">
                    <ItemGroup className="gap-3" aria-label="可选服务器">
                      {catalog.servers.map((server) => (
                        <Item key={server.id} variant="outline">
                          <ItemContent className="min-w-0">
                            <ItemTitle className="max-w-full">
                              <span className="truncate">{server.name}</span>
                            </ItemTitle>
                            <ItemDescription
                              className="block truncate text-left"
                              title={server.url}
                            >
                              {server.url}
                            </ItemDescription>
                          </ItemContent>
                          <ItemActions>
                            {(() => {
                              const check = checks[server.id]
                              const isConnecting = selectedId === server.id
                              const isChecking = !isConnecting && (!check || check === "checking")
                              const isUnavailable =
                                !isConnecting &&
                                check !== "checking" &&
                                check?.status === "unavailable"
                              return (
                                <BeButton
                                  type="button"
                                  variant={isUnavailable ? "destructive" : "primary"}
                                  size="sm"
                                  className="gap-2 rounded-md text-sm"
                                  disabled={loading || Boolean(selectedId) || isChecking}
                                  aria-label={
                                    isUnavailable
                                      ? `重新检测 ${server.name}`
                                      : isChecking
                                        ? `正在检测 ${server.name}`
                                        : `进入 ${server.name}`
                                  }
                                  onClick={() =>
                                    void (isUnavailable ? checkOne(server.id) : select(server.id))
                                  }
                                >
                                  {isConnecting || isChecking ? (
                                    <HugeiconsIcon
                                      icon={Loading03Icon}
                                      className="size-4 animate-spin"
                                      aria-hidden
                                    />
                                  ) : isUnavailable ? (
                                    <HugeiconsIcon
                                      icon={AlertCircleIcon}
                                      className="size-4"
                                      aria-hidden
                                    />
                                  ) : (
                                    <HugeiconsIcon
                                      icon={ArrowRight01Icon}
                                      className="size-4"
                                      aria-hidden
                                    />
                                  )}
                                  {isConnecting
                                    ? "正在连接"
                                    : isChecking
                                      ? "加载"
                                      : isUnavailable
                                        ? "错误"
                                        : "进入"}
                                </BeButton>
                              )
                            })()}
                          </ItemActions>
                        </Item>
                      ))}
                    </ItemGroup>
                  </div>
                  <BeButton
                    type="button"
                    variant="outline"
                    size="md"
                    className="w-full rounded-md"
                    disabled={loading || Boolean(selectedId)}
                    onClick={() => setSettingsOpen(true)}
                  >
                    <HugeiconsIcon icon={Add01Icon} className="size-4" aria-hidden />
                    添加服务器
                  </BeButton>
                </div>
              </CardContent>
            </Card>
            <SettingsDialog
              theme={theme}
              catalog={catalog}
              disabled={Boolean(selectedId) || loading || isPreview}
              defaultSection="servers"
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              trigger={null}
              onThemeChange={onThemeChange}
              onCatalogChange={onCatalogChange}
            />
          </div>
        </div>
        <PoweredBy />
      </div>
    </main>
  )
}
