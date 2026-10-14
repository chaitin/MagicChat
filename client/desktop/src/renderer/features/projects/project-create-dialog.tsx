import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react"
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
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { DesktopConversation, DesktopProjectSummary } from "../../../shared/account-data"
import { createUserSearchIndex, matchesUserSearch } from "../../../shared/user-search"

const maxProjectGroupCount = 100

export function ProjectCreateDialog({
  targetId,
  theme,
  groups,
  loading,
  onClose,
  onCreated,
}: {
  targetId: string
  theme: "light" | "dark"
  groups: DesktopConversation[]
  loading: boolean
  onClose: () => void
  onCreated: (project: DesktopProjectSummary) => void
}) {
  const { showToast } = useAnimatedToast()
  const nameId = useId()
  const searchId = useId()
  const mounted = useRef(true)
  const [name, setName] = useState("")
  const [groupKeyword, setGroupKeyword] = useState("")
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(() => new Set())
  const [creating, setCreating] = useState(false)
  const indexedGroups = useMemo(
    () =>
      groups.map((group) => ({
        group,
        search: createUserSearchIndex({ name: group.name, nickname: "", email: "", phone: "" }),
      })),
    [groups],
  )
  const filteredGroups = useMemo(
    () =>
      indexedGroups
        .filter(({ search }) => matchesUserSearch(search, groupKeyword))
        .map(({ group }) => group),
    [indexedGroups, groupKeyword],
  )
  const canCreate = Boolean(name.trim()) && !loading && !creating

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  function handleOpenChange(open: boolean) {
    if (!open && !creating) onClose()
  }

  function toggleGroup(groupId: string, checked: boolean | "indeterminate") {
    setSelectedGroupIds((current) => {
      if (checked === true && !current.has(groupId) && current.size >= maxProjectGroupCount) {
        return current
      }
      const next = new Set(current)
      if (checked === true) next.add(groupId)
      else next.delete(groupId)
      return next
    })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canCreate || !window.desktop) return
    setCreating(true)
    try {
      const result = await window.desktop.accountData.createProject({
        targetId,
        name: name.trim(),
        groupIds: [...selectedGroupIds],
      })
      if (!mounted.current) return
      if (!result.ok) throw new Error(result.error.message)
      showToast({ title: "项目已创建", status: "success" })
      onCreated(result.data)
    } catch (error) {
      if (mounted.current) {
        showToast({
          title: error instanceof Error ? error.message : "创建项目失败",
          status: "error",
        })
      }
    } finally {
      if (mounted.current) setCreating(false)
    }
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="gap-5 sm:max-w-lg" showCloseButton={!creating}>
        <DialogHeader>
          <DialogTitle className="text-base">新建项目</DialogTitle>
          <DialogDescription className="sr-only">输入项目名称并选择要关联的群聊</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor={nameId}>项目名称</Label>
            <Input
              autoFocus
              id={nameId}
              maxLength={120}
              disabled={creating}
              placeholder="输入项目名称"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={searchId}>
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
                id={searchId}
                className="pl-8"
                disabled={loading || creating}
                placeholder="搜索群聊"
                type="search"
                value={groupKeyword}
                onChange={(event) => setGroupKeyword(event.target.value)}
              />
            </div>
          </div>
          <ScrollArea
            className="h-64 rounded-md border"
            viewportClassName="[&>div]:block! [&>div]:w-full!"
            aria-busy={loading}
          >
            <div className="grid gap-1 p-2">
              {loading ? (
                <div className="py-10 text-center text-sm text-muted-foreground" role="status">
                  正在读取群聊
                </div>
              ) : filteredGroups.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  {groupKeyword.trim() ? "没有匹配的群聊" : "暂无可关联群聊"}
                </div>
              ) : (
                filteredGroups.map((group) => {
                  const checkboxId = `${searchId}-${group.id}`
                  const selected = selectedGroupIds.has(group.id)
                  const selectionDisabled =
                    !selected && selectedGroupIds.size >= maxProjectGroupCount
                  return (
                    <Label
                      key={group.id}
                      htmlFor={checkboxId}
                      className={cn(
                        "cursor-pointer rounded-md px-2 py-2 font-normal hover:bg-muted",
                        selectionDisabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                      )}
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={selected}
                        disabled={creating || selectionDisabled}
                        onCheckedChange={(checked) => toggleGroup(group.id, checked)}
                      />
                      <EntityAvatar
                        targetId={targetId}
                        type="group"
                        id={group.id}
                        theme={theme}
                        size={24}
                        label={group.name}
                      />
                      <span className="min-w-0 flex-1 truncate">{group.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {group.memberCount} 人
                      </span>
                    </Label>
                  )
                })
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={creating} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!canCreate}>
              {creating && <Loader2 aria-hidden className="animate-spin" />}
              {creating ? "正在创建" : "确定"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
