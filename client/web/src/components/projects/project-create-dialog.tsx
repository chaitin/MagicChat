import * as React from "react"

import {
  createPinyinSearchText,
  normalizePinyinSearchQuery,
} from "@/lib/pinyin-search"
import { Search } from "lucide-react"
import { toast } from "sonner"

import { GroupAvatar } from "@/components/group-avatar"
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
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ClientConversation } from "@/lib/client-data-api"
import { cn } from "@/lib/utils"

const maxProjectGroupCount = 100

export function ProjectCreateDialog({
  groups,
  onCreate,
  onOpenChange,
  open,
}: {
  groups: ClientConversation[]
  onCreate: (name: string, groupIds: string[]) => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const [creating, setCreating] = React.useState(false)
  const [groupKeyword, setGroupKeyword] = React.useState("")
  const [name, setName] = React.useState("")
  const [selectedGroupIds, setSelectedGroupIds] = React.useState<Set<string>>(
    () => new Set()
  )
  const filteredGroups = React.useMemo(() => {
    const keyword = normalizePinyinSearchQuery(groupKeyword)
    return keyword
      ? groups.filter((group) =>
          createPinyinSearchText([group.name]).includes(keyword)
        )
      : groups
  }, [groupKeyword, groups])
  const trimmedName = name.trim()
  const canCreate = trimmedName.length > 0 && !creating

  function resetForm() {
    setCreating(false)
    setGroupKeyword("")
    setName("")
    setSelectedGroupIds(new Set())
  }

  function handleOpenChange(nextOpen: boolean) {
    if (creating) return
    if (!nextOpen) resetForm()
    onOpenChange(nextOpen)
  }

  function toggleGroup(groupId: string, checked: boolean | string) {
    setSelectedGroupIds((currentIds) => {
      if (
        checked === true &&
        !currentIds.has(groupId) &&
        currentIds.size >= maxProjectGroupCount
      ) {
        return currentIds
      }
      const nextIds = new Set(currentIds)
      if (checked === true) nextIds.add(groupId)
      else nextIds.delete(groupId)
      return nextIds
    })
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canCreate) return

    setCreating(true)
    try {
      await onCreate(trimmedName, Array.from(selectedGroupIds))
      resetForm()
      onOpenChange(false)
      toast.success("项目已创建")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建项目失败")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="gap-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">新建项目</DialogTitle>
          <DialogDescription className="sr-only">
            输入项目名称并选择要关联的群聊
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="create-project-name">项目名称</Label>
            <Input
              autoFocus
              disabled={creating}
              id="create-project-name"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="输入项目名称"
              value={name}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-project-group-search">
              关联群聊
              {selectedGroupIds.size > 0 && (
                <span className="font-normal text-muted-foreground">
                  已选择 {selectedGroupIds.size}/{maxProjectGroupCount} 个
                </span>
              )}
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                disabled={creating}
                id="create-project-group-search"
                onChange={(event) => setGroupKeyword(event.target.value)}
                placeholder="搜索群聊"
                type="search"
                value={groupKeyword}
              />
            </div>
          </div>
          <ScrollArea className="h-64 rounded-md border">
            <div className="grid gap-1 p-2">
              {filteredGroups.length === 0 && (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  {groupKeyword.trim() ? "没有匹配的群聊" : "暂无可关联群聊"}
                </div>
              )}
              {filteredGroups.map((group) => {
                const checkboxId = `create-project-group-${group.id}`
                const selected = selectedGroupIds.has(group.id)
                const selectionDisabled =
                  !selected && selectedGroupIds.size >= maxProjectGroupCount

                return (
                  <Label
                    className={cn(
                      "cursor-pointer rounded-md px-2 py-2 font-normal hover:bg-muted",
                      selectionDisabled &&
                        "cursor-not-allowed opacity-50 hover:bg-transparent"
                    )}
                    htmlFor={checkboxId}
                    key={group.id}
                  >
                    <Checkbox
                      checked={selected}
                      disabled={creating || selectionDisabled}
                      id={checkboxId}
                      onCheckedChange={(checked) =>
                        toggleGroup(group.id, checked)
                      }
                    />
                    <GroupAvatar
                      avatar={group.avatar}
                      members={group.members}
                      name={group.name}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {group.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {group.memberCount} 人
                    </span>
                  </Label>
                )
              })}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button
              disabled={creating}
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button disabled={!canCreate} type="submit">
              {creating ? "正在创建" : "确定"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
