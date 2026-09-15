import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  Loading03Icon,
  PencilEdit02Icon,
  Radar03Icon,
} from "@hugeicons/core-free-icons"
import { useEffect, useState, type FormEvent } from "react"
import { Button as BeButton } from "@/components/motion/button/base"
import { Input as BeInput } from "@/components/motion/input"
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
import { Badge } from "@/components/ui/badge"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  normalizeServer,
  normalizeServerName,
  type ServerCatalog,
  type ServerCheck,
  type ServerProfile,
} from "../../shared/auth"

type Editor = {
  id?: string
  name: string
  address: string
}

type CheckState = ServerCheck | "checking"

export function ServerSettings({
  catalog,
  disabled,
  onCatalogChange,
}: {
  catalog: ServerCatalog
  disabled: boolean
  onCatalogChange: (catalog: ServerCatalog) => void
}) {
  const [checks, setChecks] = useState<Record<string, CheckState>>({})
  const [editor, setEditor] = useState<Editor | null>(null)
  const [problem, setProblem] = useState("")
  const [checkingAll, setCheckingAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<ServerProfile | null>(null)
  const editedProfile = editor?.id
    ? catalog.servers.find((item) => item.id === editor.id)
    : undefined
  const activeAddressLocked = editedProfile?.id === catalog.activeServerId

  async function checkAll(targetCatalog = catalog) {
    if (checkingAll) return
    if (!window.desktop) {
      setChecks((value) => failedChecks(value, targetCatalog.servers, "桌面服务暂不可用"))
      return
    }
    setProblem("")
    setCheckingAll(true)
    setChecks((value) => ({
      ...value,
      ...Object.fromEntries(targetCatalog.servers.map((item) => [item.id, "checking" as const])),
    }))
    try {
      const result = await window.desktop.auth.checkServers()
      if (!result.ok) {
        setProblem(result.error.message)
        setChecks((value) => failedChecks(value, targetCatalog.servers, result.error.message))
        return
      }
      setChecks((value) => ({
        ...value,
        ...Object.fromEntries(result.data.map((item) => [item.serverId, item])),
      }))
    } catch {
      setProblem("无法检测服务器，请稍后重试")
      setChecks((value) => failedChecks(value, targetCatalog.servers, "无法检测服务器，请稍后重试"))
    } finally {
      setCheckingAll(false)
    }
  }

  useEffect(() => {
    void checkAll()
    // 进入服务器页面时检测一次；保存服务器后会再次检测全部服务器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function beginEdit(profile?: ServerProfile) {
    setProblem("")
    setEditor(
      profile
        ? {
            id: profile.id,
            name: profile.name,
            address: profile.url,
          }
        : { name: "", address: "" },
    )
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!editor || !window.desktop || saving) return
    setProblem("")
    let name: string
    let server: { url: string; allowInsecureHttp: boolean }
    try {
      name = normalizeServerName(editor.name)
      server = normalizeServer({ url: editor.address, allowInsecureHttp: false })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "请检查服务器配置")
      return
    }
    setSaving(true)
    try {
      const result = await window.desktop.auth.saveServer({ id: editor.id, name, ...server })
      if (!result.ok) {
        setProblem(result.error.message)
        return
      }
      onCatalogChange(result.data.catalog)
      setEditor(null)
      void checkAll(result.data.catalog)
    } catch {
      setProblem("无法保存服务器，请稍后重试")
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!window.desktop || deleting) return
    setProblem("")
    setDeleting(id)
    try {
      const result = await window.desktop.auth.deleteServer(id)
      if (!result.ok) {
        setProblem(result.error.message)
        return
      }
      onCatalogChange(result.data)
      setChecks((value) => {
        const next = { ...value }
        delete next[id]
        return next
      })
      if (editor?.id === id) setEditor(null)
      setDeleteTarget(null)
    } catch {
      setProblem("无法删除服务器，请稍后重试")
    } finally {
      setDeleting("")
    }
  }

  return (
    <section className="min-w-0 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{catalog.servers.length} 个服务器</span>
        <div className="flex shrink-0 gap-2">
          <BeButton
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || checkingAll}
            onClick={() => void checkAll()}
          >
            {checkingAll ? (
              <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />
            ) : (
              <HugeiconsIcon icon={Radar03Icon} aria-hidden />
            )}
            {checkingAll ? "检测中" : "检测"}
          </BeButton>
          <BeButton type="button" size="sm" disabled={disabled} onClick={() => beginEdit()}>
            <HugeiconsIcon icon={Add01Icon} aria-hidden />
            添加服务器
          </BeButton>
        </div>
      </div>

      {problem && <FieldError role="alert">{problem}</FieldError>}

      <Dialog
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open && !saving) setEditor(null)
        }}
      >
        {editor && (
          <DialogContent
            className="sm:max-w-md"
            onPointerDownOutside={(event) => {
              if (saving) event.preventDefault()
            }}
          >
            <DialogHeader>
              <DialogTitle>{editor.id ? "编辑服务器" : "添加服务器"}</DialogTitle>
            </DialogHeader>
            <form className="space-y-4" onSubmit={(event) => void save(event)}>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="server-name">服务器名称</FieldLabel>
                  <BeInput
                    id="server-name"
                    value={editor.name}
                    onChange={(name) => setEditor({ ...editor, name })}
                    placeholder="长亭科技"
                    maxLength={64}
                    disabled={saving}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="settings-server-address">服务器地址</FieldLabel>
                  <BeInput
                    id="settings-server-address"
                    value={editor.address}
                    onChange={(address) => setEditor({ ...editor, address })}
                    placeholder="https://chat.chaitin.net"
                    spellCheck={false}
                    autoComplete="url"
                    maxLength={2048}
                    disabled={saving || activeAddressLocked}
                  />
                  {activeAddressLocked && (
                    <FieldDescription>
                      当前服务器只能修改名称；如需修改地址，请先返回服务器选择页并切换。
                    </FieldDescription>
                  )}
                </Field>
              </FieldGroup>
              <div className="flex justify-end gap-2">
                <BeButton
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => setEditor(null)}
                >
                  取消
                </BeButton>
                <BeButton type="submit" disabled={saving}>
                  {saving && (
                    <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />
                  )}
                  {saving ? "保存中" : "保存"}
                </BeButton>
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>删除服务器？</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除“<span className="break-all">{deleteTarget?.name}</span>”吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deleting)}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={Boolean(deleting)}
              onClick={() => {
                if (deleteTarget) void remove(deleteTarget.id)
              }}
            >
              {deleting && (
                <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />
              )}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="space-y-3" aria-label="服务器列表">
        {catalog.servers.map((server) => {
          const check = checks[server.id]
          const isChecking = !check || check === "checking"
          const isUnavailable = !isChecking && check.status === "unavailable"
          return (
            <article key={server.id} className="w-full min-w-0 rounded-lg border p-4">
              <div className="grid min-w-0 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
                <div
                  className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md ${
                    isChecking
                      ? "bg-muted text-muted-foreground"
                      : isUnavailable
                        ? "bg-destructive/10 text-destructive"
                        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  <HugeiconsIcon
                    icon={
                      isChecking
                        ? Loading03Icon
                        : isUnavailable
                          ? AlertCircleIcon
                          : CheckmarkCircle02Icon
                    }
                    className={`size-4${isChecking ? " animate-spin" : ""}`}
                    aria-label={isChecking ? "检测中" : isUnavailable ? "不可用" : "可用"}
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="min-w-0 truncate font-medium" title={server.name}>
                      {server.name}
                    </h3>
                    {check &&
                      check !== "checking" &&
                      check.status === "available" &&
                      check.organizationName && (
                        <Badge
                          variant="secondary"
                          className="min-w-0 max-w-[12rem] shrink truncate"
                        >
                          {check.organizationName}
                        </Badge>
                      )}
                  </div>
                  <p className="truncate text-sm text-muted-foreground" title={server.url}>
                    {server.url}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!server.builtin && (
                    <>
                      <BeButton
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`编辑 ${server.name}`}
                        disabled={disabled}
                        onClick={() => beginEdit(server)}
                      >
                        <HugeiconsIcon icon={PencilEdit02Icon} aria-hidden />
                      </BeButton>
                      <BeButton
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`删除 ${server.name}`}
                        disabled={disabled}
                        onClick={() => setDeleteTarget(server)}
                      >
                        <HugeiconsIcon icon={Delete02Icon} aria-hidden />
                      </BeButton>
                    </>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function unavailableCheck(serverId: string, message: string): ServerCheck {
  return { serverId, status: "unavailable", checkedAt: Date.now(), message }
}

function failedChecks(
  current: Record<string, CheckState>,
  servers: ServerProfile[],
  message: string,
): Record<string, CheckState> {
  return {
    ...current,
    ...Object.fromEntries(servers.map((item) => [item.id, unavailableCheck(item.id, message)])),
  }
}
