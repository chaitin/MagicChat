import { useId, useMemo, useState, type FormEvent } from "react"
import { Loader2, Search } from "lucide-react"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Item, ItemContent, ItemGroup } from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import type {
  DesktopContactApp,
  DesktopContactUser,
  DesktopConversation,
} from "../../../../shared/account-data"

type Candidate = DesktopContactUser | DesktopContactApp

export function CreateGroupConversationDialog({
  targetId,
  currentUserId,
  theme,
  contacts,
  apps,
  loading,
  onClose,
  onCreated,
}: {
  targetId: string
  currentUserId: string
  theme: "light" | "dark"
  contacts: DesktopContactUser[]
  apps: DesktopContactApp[]
  loading: boolean
  onClose: () => void
  onCreated: (conversation: DesktopConversation) => void
}) {
  const { showToast } = useAnimatedToast()
  const nameId = useId()
  const [name, setName] = useState("新建群聊")
  const [keyword, setKeyword] = useState("")
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [creating, setCreating] = useState(false)
  const candidates = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase()
    const source: Candidate[] = [
      ...contacts.filter((contact) => contact.id.toLowerCase() !== currentUserId.toLowerCase()),
      ...apps,
    ]
    if (!query) return source
    return source.filter((candidate) => candidateSearchText(candidate).includes(query))
  }, [apps, contacts, currentUserId, keyword])
  const canCreate = Boolean(name.trim()) && !loading && !creating
  const selectedUserCount = [...selected].filter((key) => key.startsWith("user:")).length
  const selectedAppCount = selected.size - selectedUserCount

  function toggle(candidate: Candidate, checked: boolean | "indeterminate") {
    const key = candidateKey(candidate)
    setSelected((current) => {
      const next = new Set(current)
      if (checked === true) next.add(key)
      else next.delete(key)
      return next
    })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canCreate || !window.desktop) return
    setCreating(true)
    try {
      const result = await window.desktop.accountData.createGroupConversation({
        targetId,
        name: name.trim(),
        memberIds: contacts
          .filter((contact) => selected.has(candidateKey(contact)))
          .map((contact) => contact.id),
        appIds: apps.filter((app) => selected.has(candidateKey(app))).map((app) => app.id),
      })
      if (!result.ok) throw new Error(result.error.message)
      showToast({ title: "群聊已创建", status: "success" })
      onCreated(result.data)
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : "创建群聊失败",
        status: "error",
      })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !creating && onClose()}>
      <DialogContent className="gap-5 sm:max-w-lg" showCloseButton={!creating}>
        <DialogHeader>
          <DialogTitle className="text-base">发起群聊</DialogTitle>
          <DialogDescription className="sr-only">
            输入群聊名称并选择联系人或应用创建群聊
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor={nameId}>群聊名称</Label>
            <Input
              id={nameId}
              value={name}
              disabled={creating}
              placeholder="输入群聊名称"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                aria-label="搜索成员或应用"
                type="search"
                value={keyword}
                disabled={loading || creating}
                placeholder="搜索成员或应用"
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>
          </div>
          <ScrollArea
            className="-mt-2 h-64 rounded-md border"
            viewportClassName="[&>div]:block! [&>div]:w-full!"
            aria-busy={loading}
          >
            {loading ? (
              <div className="grid gap-2 p-3" role="status" aria-label="正在加载群聊成员和应用">
                {Array.from({ length: 10 }, (_, index) => (
                  <div className="flex items-center gap-3" key={index} aria-hidden="true">
                    <Skeleton className="size-6 shrink-0 rounded-sm" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="size-4 shrink-0 rounded-sm" />
                  </div>
                ))}
              </div>
            ) : candidates.length ? (
              <ItemGroup className="gap-1! p-2" aria-label="群聊成员和应用">
                {candidates.map((candidate) => {
                  const key = candidateKey(candidate)
                  const checkboxId = `create-group-${key}`
                  const displayName = candidateDisplayName(candidate)
                  return (
                    <Item
                      asChild
                      size="sm"
                      className="cursor-pointer px-2 py-1 hover:bg-muted data-[selected=true]:bg-xgui-background-0 data-[selected=true]:hover:bg-xgui-background-0"
                      data-selected={selected.has(key)}
                      key={key}
                    >
                      <Label htmlFor={checkboxId} role="listitem">
                        <EntityAvatar
                          targetId={targetId}
                          type={candidate.avatarType}
                          id={candidate.avatarId}
                          theme={theme}
                          size={24}
                          label={displayName}
                        />
                        <ItemContent className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2 text-sm">
                            <span className="truncate">{displayName}</span>
                            {candidate.avatarType === "app" && (
                              <Badge variant="outline">应用</Badge>
                            )}
                          </span>
                        </ItemContent>
                        <Checkbox
                          id={checkboxId}
                          checked={selected.has(key)}
                          disabled={creating}
                          aria-label={displayName}
                          onCheckedChange={(checked) => toggle(candidate, checked)}
                        />
                      </Label>
                    </Item>
                  )
                })}
              </ItemGroup>
            ) : (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                没有匹配的成员或应用
              </div>
            )}
          </ScrollArea>
          <DialogFooter className="flex-row items-center justify-between sm:justify-between">
            <span className="shrink-0 text-sm text-foreground" aria-live="polite">
              已选择 {selectedUserCount} 人{selectedAppCount > 0 && `、${selectedAppCount} 个应用`}
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={creating} onClick={onClose}>
                取消
              </Button>
              <Button type="submit" disabled={!canCreate}>
                {creating && <Loader2 aria-hidden className="animate-spin" />}
                创建
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function candidateKey(candidate: Candidate) {
  return `${candidate.avatarType}:${candidate.id}`
}

function candidateDisplayName(candidate: Candidate) {
  return candidate.avatarType === "user" ? candidate.nickname || candidate.name : candidate.name
}

function candidateSearchText(candidate: Candidate) {
  return candidate.avatarType === "user"
    ? [candidate.name, candidate.nickname, candidate.email, candidate.phone]
        .join("\n")
        .toLocaleLowerCase()
    : [candidate.name, candidate.description].join("\n").toLocaleLowerCase()
}
