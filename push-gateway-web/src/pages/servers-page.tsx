import {
  BanIcon,
  CheckIcon,
  CircleCheckIcon,
  CopyIcon,
  EyeIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RotateCwIcon,
  ServerIcon,
} from "lucide-react"
import { useEffect, useId, useState, type FormEvent } from "react"
import { toast } from "sonner"

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
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  createServer,
  listServers,
  revealServerKey,
  rotateServerKey,
  setServerStatus,
  updateServer as updateServerAPI,
} from "@/lib/server-api"
import {
  formatCount,
  quotaUsagePercent,
  type IssuedServerKey,
  type PushServer,
  type PushServerDraft,
} from "@/lib/server-model"

const MAX_DAILY_LIMIT = 100_000_000

type ServerEditor = { mode: "create" } | { mode: "edit"; server: PushServer }
type KeyDialogState = IssuedServerKey

export default function ServersPage() {
  const [servers, setServers] = useState<PushServer[]>([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<ServerEditor | null>(null)
  const [keyDialog, setKeyDialog] = useState<KeyDialogState | null>(null)
  const [rotateTarget, setRotateTarget] = useState<PushServer | null>(null)

  useEffect(() => {
    let active = true
    void listServers()
      .then((result) => {
        if (active) setServers(result)
      })
      .catch((error) => {
        if (active) toast.error(errorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  function updateServer(server: PushServer) {
    setServers((current) =>
      current.map((item) => (item.id === server.id ? server : item))
    )
  }

  async function handleSaved(draft: PushServerDraft) {
    if (!editor) return
    if (editor.mode === "create") {
      const result = await createServer(draft)
      setServers((current) => [result.server, ...current])
      setEditor(null)
      setKeyDialog(result)
      return
    }
    const server = await updateServerAPI(editor.server.id, draft)
    updateServer(server)
    setEditor(null)
    toast.success("服务器配置已更新")
  }

  async function toggleServer(server: PushServer, enabled: boolean) {
    try {
      const updated = await setServerStatus(
        server.id,
        enabled ? "active" : "disabled"
      )
      updateServer(updated)
      toast.success(enabled ? "服务器已启用" : "服务器已停用")
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function rotateCurrentServerKey() {
    if (!rotateTarget) return
    try {
      const result = await rotateServerKey(rotateTarget.id)
      updateServer(result.server)
      setRotateTarget(null)
      setKeyDialog(result)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function viewServerKey(server: PushServer) {
    try {
      const result = await revealServerKey(server.id)
      setKeyDialog({ key: result.key, server })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <>
      <div className="grid min-w-0 flex-1 items-start gap-4 p-4 pt-0">
        <Card className="min-w-0">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <CardTitle>服务器</CardTitle>
              <Button onClick={() => setEditor({ mode: "create" })}>
                <PlusIcon />
                添加服务器
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <div className="overflow-x-auto">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-56">服务器</TableHead>
                      <TableHead className="w-32">状态</TableHead>
                      <TableHead className="w-40">今日用量</TableHead>
                      <TableHead className="w-40">每日额度</TableHead>
                      <TableHead className="w-24 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell className="h-24 text-center" colSpan={5}>
                          正在加载...
                        </TableCell>
                      </TableRow>
                    ) : servers.length === 0 ? (
                      <TableRow>
                        <TableCell className="h-24 text-center" colSpan={5}>
                          暂无服务器
                        </TableCell>
                      </TableRow>
                    ) : (
                      servers.map((server) => (
                        <ServerTableRow
                          key={server.id}
                          onEdit={() => setEditor({ mode: "edit", server })}
                          onRotate={() => setRotateTarget(server)}
                          onStatusChange={(enabled) =>
                            toggleServer(server, enabled)
                          }
                          onViewKey={() => void viewServerKey(server)}
                          server={server}
                        />
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <ServerEditorDialog
        editor={editor}
        key={
          !editor
            ? "closed"
            : editor.mode === "edit"
              ? editor.server.id
              : "create"
        }
        onOpenChange={(open) => {
          if (!open) setEditor(null)
        }}
        onSaved={handleSaved}
      />

      <ServerKeyDialog
        dialog={keyDialog}
        key={keyDialog?.key ?? "empty"}
        onClose={() => setKeyDialog(null)}
      />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setRotateTarget(null)
        }}
        open={rotateTarget !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置密钥？</AlertDialogTitle>
            <AlertDialogDescription>
              旧密钥将立即失效。请复制新密钥并及时更新私有服务器配置。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void rotateCurrentServerKey()}>
              确认重置
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ServerTableRow({
  onEdit,
  onRotate,
  onStatusChange,
  onViewKey,
  server,
}: {
  onEdit: () => void
  onRotate: () => void
  onStatusChange: (enabled: boolean) => void
  onViewKey: () => void
  server: PushServer
}) {
  const percent = quotaUsagePercent(server)
  const active = server.status === "active"

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <ServerIcon className="size-4" />
          </div>
          <div className="min-w-0 truncate font-medium">{server.name}</div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={active ? "default" : "secondary"}>
          {active ? "已启用" : "已停用"}
        </Badge>
      </TableCell>
      <TableCell>
        <Progress value={percent} />
      </TableCell>
      <TableCell className="font-mono text-sm tabular-nums">
        {formatCount(server.dailyLimit)} 次
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={`管理${server.name}`}
                size="icon-sm"
                variant="ghost"
              >
                <MoreHorizontalIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onViewKey}>
                <EyeIcon />
                查看密钥
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <PencilIcon />
                修改信息
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRotate}>
                <RotateCwIcon />
                重置密钥
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onStatusChange(!active)}
                variant={active ? "destructive" : "default"}
              >
                {active ? <BanIcon /> : <CircleCheckIcon />}
                {active ? "禁用" : "启用"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

function ServerEditorDialog({
  editor,
  onOpenChange,
  onSaved,
}: {
  editor: ServerEditor | null
  onOpenChange: (open: boolean) => void
  onSaved: (draft: PushServerDraft) => Promise<void>
}) {
  const nameId = useId()
  const limitId = useId()
  const editing = editor?.mode === "edit" ? editor.server : null
  const [name, setName] = useState(editing?.name ?? "")
  const [dailyLimit, setDailyLimit] = useState(
    String(editing?.dailyLimit ?? 10_000)
  )
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedName = name.trim()
    const normalizedLimit = Number(dailyLimit)
    if (!normalizedName) {
      toast.error("请输入服务器名称")
      return
    }
    if (
      !Number.isSafeInteger(normalizedLimit) ||
      normalizedLimit < 1 ||
      normalizedLimit > MAX_DAILY_LIMIT
    ) {
      toast.error(`每日额度必须是 1 到 ${formatCount(MAX_DAILY_LIMIT)} 的整数`)
      return
    }

    setPending(true)
    try {
      await onSaved({ dailyLimit: normalizedLimit, name: normalizedName })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={editor !== null}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? "修改信息" : "添加服务器"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "调整显示名称和每日允许创建的推送任务数量。"
                : "创建后会生成该私有服务器专用的访问密钥。"}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-6">
            <Field>
              <FieldLabel htmlFor={nameId}>服务器名称</FieldLabel>
              <Input
                autoFocus
                disabled={pending}
                id={nameId}
                maxLength={64}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：生产环境一号"
                value={name}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={limitId}>每日推送额度</FieldLabel>
              <Input
                disabled={pending}
                id={limitId}
                inputMode="numeric"
                max={MAX_DAILY_LIMIT}
                min={1}
                onChange={(event) => setDailyLimit(event.target.value)}
                type="number"
                value={dailyLimit}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button disabled={pending} type="submit">
              {pending ? "保存中..." : editing ? "保存" : "创建并生成密钥"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "请求失败，请稍后重试"
}

function ServerKeyDialog({
  dialog,
  onClose,
}: {
  dialog: KeyDialogState | null
  onClose: () => void
}) {
  const keyInputId = useId()
  const [copied, setCopied] = useState(false)

  async function copyKey() {
    if (!dialog) return
    try {
      await navigator.clipboard.writeText(dialog.key)
      setCopied(true)
      toast.success("服务器密钥已复制")
    } catch {
      toast.error("复制失败，请手动复制")
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={dialog !== null}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>查看密钥</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={keyInputId}>服务器密钥</Label>
          <Input
            className="font-mono"
            id={keyInputId}
            readOnly
            value={dialog?.key ?? ""}
          />
        </div>
        <DialogFooter>
          <Button onClick={() => void copyKey()} variant="outline">
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "已复制" : "复制密钥"}
          </Button>
          <Button onClick={onClose}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
