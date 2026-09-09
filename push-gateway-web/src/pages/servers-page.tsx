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
import { useId, useState, type FormEvent } from "react"
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
  createMockServer,
  formatCount,
  MOCK_SERVER_KEYS,
  MOCK_SERVERS,
  quotaUsagePercent,
  rotateMockServerKey,
  type IssuedServerKey,
  type PushServer,
} from "@/lib/server-model"

const MAX_DAILY_LIMIT = 100_000_000

type ServerEditor = { mode: "create" } | { mode: "edit"; server: PushServer }
type KeyDialogState = IssuedServerKey & { mode: "issued" | "view" }

export default function ServersPage() {
  const [servers, setServers] = useState(() => [...MOCK_SERVERS])
  const [serverKeys, setServerKeys] = useState(() => ({ ...MOCK_SERVER_KEYS }))
  const [editor, setEditor] = useState<ServerEditor | null>(null)
  const [keyDialog, setKeyDialog] = useState<KeyDialogState | null>(null)
  const [rotateTarget, setRotateTarget] = useState<PushServer | null>(null)

  function updateServer(server: PushServer) {
    setServers((current) =>
      current.map((item) => (item.id === server.id ? server : item))
    )
  }

  function handleSaved(server: PushServer, key?: string) {
    if (editor?.mode === "create") {
      setServers((current) => [server, ...current])
    } else {
      updateServer(server)
    }
    setEditor(null)
    if (key) {
      setServerKeys((current) => ({ ...current, [server.id]: key }))
      setKeyDialog({ key, mode: "issued", server })
    } else {
      toast.success("服务器配置已更新")
    }
  }

  function toggleServer(server: PushServer, enabled: boolean) {
    updateServer({ ...server, status: enabled ? "active" : "disabled" })
    toast.success(enabled ? "服务器已启用" : "服务器已停用")
  }

  function rotateServerKey() {
    if (!rotateTarget) return
    const result = rotateMockServerKey(rotateTarget)
    updateServer(result.server)
    setServerKeys((current) => ({
      ...current,
      [result.server.id]: result.key,
    }))
    setRotateTarget(null)
    setKeyDialog({ ...result, mode: "issued" })
  }

  function viewServerKey(server: PushServer) {
    const key = serverKeys[server.id]
    if (!key) {
      toast.error("暂时无法读取服务器 Key")
      return
    }
    setKeyDialog({ key, mode: "view", server })
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
                    {servers.map((server) => (
                      <ServerTableRow
                        key={server.id}
                        onEdit={() => setEditor({ mode: "edit", server })}
                        onRotate={() => setRotateTarget(server)}
                        onStatusChange={(enabled) =>
                          toggleServer(server, enabled)
                        }
                        onViewKey={() => viewServerKey(server)}
                        server={server}
                      />
                    ))}
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
        key={keyDialog ? `${keyDialog.mode}:${keyDialog.key}` : "empty"}
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
            <AlertDialogTitle>轮换服务器 Key？</AlertDialogTitle>
            <AlertDialogDescription>
              旧 Key 将立即失效。请复制新 Key 并及时更新私有服务器配置。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={rotateServerKey}>
              确认轮换
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
        {formatCount(server.dailyLimit)} 次/日
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
                查看 Key
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <PencilIcon />
                编辑配置
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRotate}>
                <RotateCwIcon />
                轮换 Key
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onStatusChange(!active)}
                variant={active ? "destructive" : "default"}
              >
                {active ? <BanIcon /> : <CircleCheckIcon />}
                {active ? "禁用服务器" : "启用服务器"}
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
  onSaved: (server: PushServer, key?: string) => void
}) {
  const nameId = useId()
  const limitId = useId()
  const editing = editor?.mode === "edit" ? editor.server : null
  const [name, setName] = useState(editing?.name ?? "")
  const [dailyLimit, setDailyLimit] = useState(
    String(editing?.dailyLimit ?? 10_000)
  )

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
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

    if (editing) {
      onSaved({ ...editing, dailyLimit: normalizedLimit, name: normalizedName })
      return
    }
    const result = createMockServer({
      dailyLimit: normalizedLimit,
      name: normalizedName,
    })
    onSaved(result.server, result.key)
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={editor !== null}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑服务器" : "添加服务器"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "调整显示名称和每日允许创建的推送任务数量。"
                : "创建后会生成该私有服务器专用的访问 Key。"}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-6">
            <Field>
              <FieldLabel htmlFor={nameId}>服务器名称</FieldLabel>
              <Input
                autoFocus
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
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button type="submit">{editing ? "保存" : "创建并生成 Key"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ServerKeyDialog({
  dialog,
  onClose,
}: {
  dialog: KeyDialogState | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copyKey() {
    if (!dialog) return
    try {
      await navigator.clipboard.writeText(dialog.key)
      setCopied(true)
      toast.success("服务器 Key 已复制")
    } catch {
      toast.error("复制失败，请手动复制")
    }
  }

  const viewing = dialog?.mode === "view"
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={dialog !== null}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {viewing ? "查看服务器 Key" : "保存服务器 Key"}
          </DialogTitle>
        </DialogHeader>
        <div className="my-5 rounded-lg border bg-muted/40 p-4">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            服务器 Key
          </div>
          <code className="block font-mono text-sm leading-6 break-all">
            {dialog?.key}
          </code>
        </div>
        <DialogFooter className="mt-5">
          <Button onClick={() => void copyKey()} variant="outline">
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "已复制" : "复制 Key"}
          </Button>
          <Button onClick={onClose}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
