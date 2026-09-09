import {
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
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
  formatLastUsed,
  MOCK_SERVERS,
  quotaUsagePercent,
  rotateMockServerKey,
  type IssuedServerKey,
  type PushServer,
} from "@/lib/server-model"

const MAX_DAILY_LIMIT = 100_000_000

type ServerEditor = { mode: "create" } | { mode: "edit"; server: PushServer }

export default function ServersPage() {
  const [servers, setServers] = useState(() => [...MOCK_SERVERS])
  const [editor, setEditor] = useState<ServerEditor | null>(null)
  const [issuedKey, setIssuedKey] = useState<IssuedServerKey | null>(null)
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
      setIssuedKey({ key, server })
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
    setRotateTarget(null)
    setIssuedKey(result)
  }

  return (
    <>
      <div className="grid min-w-0 flex-1 items-start gap-4 p-4 pt-0">
        <Card className="min-w-0">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle>服务器</CardTitle>
                <p className="text-sm text-muted-foreground">
                  管理允许使用推送服务的私有服务器及其每日额度。
                </p>
              </div>
              <Button onClick={() => setEditor({ mode: "create" })}>
                <PlusIcon />
                添加服务器
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <div className="overflow-x-auto">
                <Table className="min-w-[980px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-56">服务器</TableHead>
                      <TableHead className="w-32">状态</TableHead>
                      <TableHead className="min-w-64">今日用量</TableHead>
                      <TableHead className="w-40">每日额度</TableHead>
                      <TableHead className="w-44">最近使用</TableHead>
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

      <IssuedKeyDialog
        issued={issuedKey}
        key={issuedKey?.key ?? "empty"}
        onClose={() => setIssuedKey(null)}
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
              旧 Key 将立即失效。新 Key
              只会展示一次，请在关闭窗口前完成复制并更新私有服务器配置。
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
  server,
}: {
  onEdit: () => void
  onRotate: () => void
  onStatusChange: (enabled: boolean) => void
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
          <div className="min-w-0">
            <div className="truncate font-medium">{server.name}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-mono">{server.id}</span>
              <span>·</span>
              <KeyRoundIcon className="size-3" />
              <span className="font-mono">{server.keyFingerprint}</span>
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <Switch
            aria-label={`${active ? "停用" : "启用"}${server.name}`}
            checked={active}
            onCheckedChange={onStatusChange}
          />
          <Badge variant={active ? "default" : "secondary"}>
            {active ? "已启用" : "已停用"}
          </Badge>
        </div>
      </TableCell>
      <TableCell>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium tabular-nums">
              {formatCount(server.todayUsage)}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {percent}%
            </span>
          </div>
          <Progress value={percent} />
        </div>
      </TableCell>
      <TableCell className="font-mono text-sm tabular-nums">
        {formatCount(server.dailyLimit)} 次/日
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatLastUsed(server.lastUsedAt)}
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
              <DropdownMenuItem onClick={onEdit}>
                <PencilIcon />
                编辑配置
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRotate}>
                <RotateCwIcon />
                轮换 Key
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
              <FieldDescription>
                仅用于管理识别，不填写服务器地址。
              </FieldDescription>
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
              <FieldDescription>
                按北京时间自然日统计，幂等重试不重复计费。
              </FieldDescription>
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

function IssuedKeyDialog({
  issued,
  onClose,
}: {
  issued: IssuedServerKey | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copyKey() {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.key)
      setCopied(true)
      toast.success("服务器 Key 已复制")
    } catch {
      toast.error("复制失败，请手动复制")
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={issued !== null}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>保存服务器 Key</DialogTitle>
          <DialogDescription>
            这是“{issued?.server.name}”的访问 Key。关闭后将无法再次查看明文。
          </DialogDescription>
        </DialogHeader>
        <div className="my-5 rounded-lg border bg-muted/40 p-4">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            服务器 Key
          </div>
          <code className="block font-mono text-sm leading-6 break-all">
            {issued?.key}
          </code>
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          请立即复制并保存到私有服务器 Secret 中。系统只保存 Key 哈希。
        </div>
        <DialogFooter className="mt-5">
          <Button onClick={() => void copyKey()} variant="outline">
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "已复制" : "复制 Key"}
          </Button>
          <Button onClick={onClose}>我已保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
