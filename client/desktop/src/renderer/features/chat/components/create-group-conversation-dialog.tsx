import { useId, useMemo, useState, type FormEvent } from "react"
import { Loader2, Search } from "lucide-react"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  onClose,
  onCreated,
}: {
  targetId: string
  currentUserId: string
  theme: "light" | "dark"
  contacts: DesktopContactUser[]
  apps: DesktopContactApp[]
  onClose: () => void
  onCreated: (conversation: DesktopConversation) => void
}) {
  const { showToast } = useAnimatedToast()
  const nameId = useId()
  const searchId = useId()
  const [name, setName] = useState("新建群聊")
  const [tab, setTab] = useState<"users" | "apps">("users")
  const [keyword, setKeyword] = useState("")
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [creating, setCreating] = useState(false)
  const candidates = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase()
    const source: Candidate[] =
      tab === "apps"
        ? apps
        : contacts.filter((contact) => contact.id.toLowerCase() !== currentUserId.toLowerCase())
    if (!query) return source
    return source.filter((candidate) => candidateSearchText(candidate).includes(query))
  }, [apps, contacts, currentUserId, keyword, tab])
  const canCreate = Boolean(name.trim()) && !creating

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
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setKeyword("")
              setTab(value === "apps" ? "apps" : "users")
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger disabled={creating} value="users">
                成员
              </TabsTrigger>
              <TabsTrigger disabled={creating} value="apps">
                应用
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid gap-2">
            <Label htmlFor={searchId}>{tab === "apps" ? "选择应用" : "选择成员"}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                id={searchId}
                type="search"
                value={keyword}
                disabled={creating}
                placeholder={tab === "apps" ? "搜索应用" : "搜索联系人"}
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>
          </div>
          <ScrollArea
            className="h-64 rounded-md border"
            viewportClassName="[&>div]:block! [&>div]:w-full!"
          >
            {candidates.length ? (
              <ItemGroup
                className="gap-1! p-2"
                aria-label={tab === "apps" ? "群聊应用" : "群聊成员"}
              >
                {candidates.map((candidate) => {
                  const key = candidateKey(candidate)
                  const checkboxId = `create-group-${key}`
                  const displayName = candidateDisplayName(candidate)
                  return (
                    <Item
                      asChild
                      size="sm"
                      className="cursor-pointer px-2 py-1 hover:bg-muted"
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
                          <span className="truncate text-sm">{displayName}</span>
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
                {tab === "apps" ? "没有匹配的应用" : "没有匹配的联系人"}
              </div>
            )}
          </ScrollArea>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={creating} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!canCreate}>
              {creating && <Loader2 aria-hidden className="animate-spin" />}
              创建
            </Button>
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
