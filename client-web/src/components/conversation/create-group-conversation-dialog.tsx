import * as React from "react"
import { Loader2Icon, Search } from "lucide-react"
import { toast } from "sonner"

import type { ContactApp, ContactUser } from "@/lib/client-data-api"
import { sortContactsByDisplayName } from "@/lib/contact-sort"
import { cn } from "@/lib/utils"
import { SelectionListAvatar } from "@/components/selection-list-avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function CreateGroupConversationDialog({
  apps,
  contacts,
  currentUserId,
  onCreate,
  onOpenChange,
  open,
}: {
  apps: ContactApp[]
  contacts: ContactUser[]
  currentUserId: string
  onCreate: (
    name: string,
    memberIds: string[],
    appIds: string[]
  ) => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">发起群聊</DialogTitle>
          <DialogDescription className="sr-only">
            输入群聊名称并选择联系人或应用创建群聊
          </DialogDescription>
        </DialogHeader>
        <CreateGroupConversationForm
          apps={apps}
          contacts={contacts}
          currentUserId={currentUserId}
          onCreate={onCreate}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  )
}

function CreateGroupConversationForm({
  apps,
  contacts,
  currentUserId,
  onCreate,
  onOpenChange,
}: {
  apps: ContactApp[]
  contacts: ContactUser[]
  currentUserId: string
  onCreate: (
    name: string,
    memberIds: string[],
    appIds: string[]
  ) => Promise<void>
  onOpenChange: (open: boolean) => void
}) {
  const [creating, setCreating] = React.useState(false)
  const [keyword, setKeyword] = React.useState("")
  const [name, setName] = React.useState("新建群聊")
  const [tab, setTab] = React.useState<"users" | "apps">("users")
  const [selectedCandidateKeys, setSelectedCandidateKeys] = React.useState<
    Set<string>
  >(() => new Set())
  const trimmedName = name.trim()
  const canCreate = Boolean(trimmedName) && !creating
  const filteredContacts = React.useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()

    return sortContactsByDisplayName(
      contacts.filter((contact) => {
        if (contact.id === currentUserId) {
          return false
        }
        if (!normalizedKeyword) {
          return true
        }

        return [
          contact.email,
          contact.name,
          contact.nickname,
          contact.phone,
        ].some((value) => value.toLowerCase().includes(normalizedKeyword))
      })
    )
  }, [contacts, currentUserId, keyword])
  const filteredApps = React.useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()

    if (!normalizedKeyword) {
      return apps
    }

    return apps.filter((app) =>
      [app.name, app.description].some((value) =>
        value.toLowerCase().includes(normalizedKeyword)
      )
    )
  }, [apps, keyword])
  const visibleCandidates: CreateGroupCandidate[] =
    tab === "apps" ? filteredApps : filteredContacts

  function toggleCandidate(
    candidate: CreateGroupCandidate,
    checked: boolean | string
  ) {
    const key = createGroupCandidateKey(candidate)
    setSelectedCandidateKeys((currentKeys) => {
      const nextChecked = Boolean(checked)
      const currentChecked = currentKeys.has(key)

      if (currentChecked === nextChecked) {
        return currentKeys
      }

      const nextKeys = new Set(currentKeys)

      if (nextChecked) {
        nextKeys.add(key)
      } else {
        nextKeys.delete(key)
      }

      return nextKeys
    })
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!canCreate) {
      return
    }

    setCreating(true)

    try {
      const memberIds = contacts
        .filter((contact) =>
          selectedCandidateKeys.has(createGroupCandidateKey(contact))
        )
        .map((contact) => contact.id)
      const appIds = apps
        .filter((app) =>
          selectedCandidateKeys.has(createGroupCandidateKey(app))
        )
        .map((app) => app.id)

      await onCreate(trimmedName, memberIds, appIds)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建群聊失败")
    } finally {
      setCreating(false)
    }
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <div className="grid gap-2">
        <Label htmlFor="create-group-name">群聊名称</Label>
        <Input
          id="create-group-name"
          onChange={(event) => setName(event.target.value)}
          placeholder="输入群聊名称"
          value={name}
        />
      </div>
      <Tabs
        onValueChange={(value) => {
          setKeyword("")
          setTab(value === "apps" ? "apps" : "users")
        }}
        value={tab}
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
        <Label htmlFor="create-group-member-search">
          {tab === "apps" ? "选择应用" : "选择成员"}
        </Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            id="create-group-member-search"
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={tab === "apps" ? "搜索应用" : "搜索联系人"}
            type="search"
            value={keyword}
          />
        </div>
      </div>
      <div className="h-64 overflow-y-auto rounded-md border">
        <ItemGroup
          aria-label={tab === "apps" ? "群聊应用" : "群聊成员"}
          className="gap-1 p-2 has-data-[size=sm]:gap-1"
          role="group"
        >
          {visibleCandidates.map((candidate) => {
            const key = createGroupCandidateKey(candidate)

            return (
              <CreateGroupMemberItem
                candidate={candidate}
                checked={selectedCandidateKeys.has(key)}
                key={key}
                onCheckedChange={(checked) =>
                  toggleCandidate(candidate, checked)
                }
              />
            )
          })}
          {visibleCandidates.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {tab === "apps" ? "没有匹配的应用" : "没有匹配的联系人"}
            </div>
          )}
        </ItemGroup>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button disabled={creating} type="button" variant="outline">
            取消
          </Button>
        </DialogClose>
        <Button disabled={!canCreate} type="submit">
          {creating && (
            <Loader2Icon aria-hidden="true" className="animate-spin" />
          )}
          创建
        </Button>
      </DialogFooter>
    </form>
  )
}

function CreateGroupMemberItem({
  candidate,
  checked,
  onCheckedChange,
}: {
  candidate: CreateGroupCandidate
  checked: boolean
  onCheckedChange: (checked: boolean | string) => void
}) {
  const displayName = getCreateGroupCandidateDisplayName(candidate)
  const checkboxId = `create-group-member-${candidate.type}-${candidate.id}`

  return (
    <Item
      asChild
      className={cn(
        "cursor-pointer px-2 py-1.5",
        checked ? "bg-primary/10" : "hover:bg-muted"
      )}
      size="sm"
    >
      <Label htmlFor={checkboxId}>
        <ItemMedia>
          <SelectionListAvatar avatar={candidate.avatar} name={displayName} />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="truncate">{displayName}</ItemTitle>
        </ItemContent>
        <ItemActions>
          <Checkbox
            aria-label={displayName}
            checked={checked}
            id={checkboxId}
            onCheckedChange={onCheckedChange}
          />
        </ItemActions>
      </Label>
    </Item>
  )
}

type CreateGroupCandidate = ContactUser | ContactApp

function createGroupCandidateKey(candidate: CreateGroupCandidate) {
  return `${candidate.type}:${candidate.id}`
}

function getCreateGroupCandidateDisplayName(candidate: CreateGroupCandidate) {
  return candidate.type === "user"
    ? getContactDisplayName(candidate)
    : candidate.name.trim()
}

function getContactDisplayName(contact: { name: string; nickname: string }) {
  const nickname = contact.nickname.trim()

  return nickname || contact.name.trim()
}
