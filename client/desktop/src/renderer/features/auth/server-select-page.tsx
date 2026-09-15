import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import {
  Add01Icon,
  AlertCircleIcon,
  ArrowRight01Icon,
  EnergyIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons"
import { useEffect, useRef, useState } from "react"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { Button as BeButton } from "@/components/motion/button/base"
import { cn } from "@/lib/utils"
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
import type {
  AuthResult,
  Connection,
  ServerCatalog,
  ServerCheck,
  ServerProfile,
} from "../../../shared/auth"
import type { ThemePreference } from "../../../shared/desktop"

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
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  onCatalogChange: (catalog: ServerCatalog) => void
  onSelect: (serverId: string) => Promise<AuthResult<Connection>>
}) {
  const { showToast } = useAnimatedToast()
  const shownInitialError = useRef("")
  const [selectedId, setSelectedId] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [checks, setChecks] = useState<Record<string, CheckState>>({})
  const serverKey = catalog.servers.map((server) => `${server.id}:${server.url}`).join("|")

  useEffect(() => {
    if (!initialError || shownInitialError.current === initialError) return
    shownInitialError.current = initialError
    showToast({ status: "error", title: "无法加载服务器", description: initialError })
  }, [initialError, showToast])

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
      if (!result.ok) {
        showToast({ status: "error", title: "服务器检测失败", description: result.error.message })
      }
    } catch {
      setChecks((value) => ({
        ...value,
        [serverId]: unavailableCheck(serverId, "无法检测服务器"),
      }))
      showToast({ status: "error", title: "无法检测服务器" })
    }
  }

  async function select(serverId: string) {
    if (loading || selectedId) return
    setSelectedId(serverId)
    const result = await onSelect(serverId)
    if (!result.ok) {
      showToast({ status: "error", title: "无法进入服务器", description: result.error.message })
    }
    setSelectedId("")
  }

  return (
    <main className="login-page login-page--shader">
      <div className="auth-surface auth-surface--shader grid min-h-full grid-rows-[1fr_auto] gap-4 p-6 text-foreground md:p-10">
        <div className="flex items-center justify-center">
          <div className="flex w-full max-w-sm flex-col gap-3">
            <div className="flex h-8 items-center justify-between text-sm text-muted-foreground">
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
                <div className="space-y-3">
                  <div className="max-h-72 overflow-y-auto pr-1">
                    <ItemGroup className="gap-3" aria-label="可选服务器">
                      {catalog.servers.map((server) => (
                        <ServerListItem
                          key={server.id}
                          server={server}
                          check={checks[server.id]}
                          loading={loading}
                          selectionPending={Boolean(selectedId)}
                          isConnecting={selectedId === server.id}
                          onCheck={checkOne}
                          onSelect={select}
                        />
                      ))}
                    </ItemGroup>
                  </div>
                  <BeButton
                    type="button"
                    variant="outline"
                    size="md"
                    className="w-full"
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

function ServerListItem({
  server,
  check,
  loading,
  selectionPending,
  isConnecting,
  onCheck,
  onSelect,
}: {
  server: ServerProfile
  check?: CheckState
  loading: boolean
  selectionPending: boolean
  isConnecting: boolean
  onCheck: (serverId: string) => Promise<void>
  onSelect: (serverId: string) => Promise<void>
}) {
  const isChecking = !isConnecting && (!check || check === "checking")
  const isUnavailable = !isConnecting && check !== "checking" && check?.status === "unavailable"

  return (
    <Item variant="outline">
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full">
          <span className="truncate">{server.name}</span>
        </ItemTitle>
        <ItemDescription className="block truncate text-left" title={server.url}>
          {server.url}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <BeButton
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "gap-2 text-sm",
            (isConnecting || isChecking) && "border-border text-muted-foreground",
            isUnavailable &&
              "border-destructive/80 text-destructive/85 hover:border-destructive/90 hover:bg-destructive/10 hover:text-destructive",
          )}
          disabled={loading || selectionPending || isChecking}
          aria-label={
            isUnavailable
              ? `重新检测 ${server.name}`
              : isChecking
                ? `正在检测 ${server.name}`
                : `进入 ${server.name}`
          }
          onClick={() => void (isUnavailable ? onCheck(server.id) : onSelect(server.id))}
        >
          <HugeiconsIcon
            icon={
              isConnecting || isChecking
                ? Loading03Icon
                : isUnavailable
                  ? AlertCircleIcon
                  : ArrowRight01Icon
            }
            className={cn("size-4", (isConnecting || isChecking) && "animate-spin")}
            aria-hidden
          />
          {isConnecting ? "正在连接" : isChecking ? "加载" : isUnavailable ? "重试" : "进入"}
        </BeButton>
      </ItemActions>
    </Item>
  )
}
