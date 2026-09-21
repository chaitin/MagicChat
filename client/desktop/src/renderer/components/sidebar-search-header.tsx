import { useEffect, useState } from "react"
import {
  CirclePlusIcon,
  RefreshIcon,
  Search01Icon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons"
import { GlobalSearchDialog } from "@/components/global-search-dialog"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { Button as BeButton } from "@/components/motion/button/base"
import type { LocalSearchResult } from "../../shared/account-data"
import type { MentionLabelResolver } from "@/lib/message-mentions"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function SidebarSearchHeader({
  searchLabel,
  targetId,
  theme,
  mentionLabelResolver,
  onSelectSearchResult,
  onCreateGroup,
  onCreateApp,
  onRefresh,
}: {
  searchLabel: string
  targetId: string
  theme: "light" | "dark"
  mentionLabelResolver: MentionLabelResolver
  onSelectSearchResult: (result: LocalSearchResult) => void
  onCreateGroup: () => void
  onCreateApp: () => void
  onRefresh: () => void
}) {
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    function openSearch(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return
      event.preventDefault()
      setSearchOpen(true)
    }
    document.addEventListener("keydown", openSearch)
    return () => document.removeEventListener("keydown", openSearch)
  }, [])

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 bg-xgui-background-0 pr-2 pl-3">
        <BeButton
          type="button"
          variant="ghost"
          pressScale={1}
          whileHover={{ scale: 1 }}
          className="h-8 min-w-0 flex-1 justify-start gap-2 rounded-full bg-background px-3 text-sm font-normal text-muted-foreground hover:bg-background/80 hover:text-muted-foreground [&_svg]:size-4"
          aria-label={searchLabel}
          onClick={() => setSearchOpen(true)}
        >
          <HugeiconsIcon icon={Search01Icon} className="shrink-0" aria-hidden />
          <span className="truncate">搜索</span>
        </BeButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <BeButton
              type="button"
              variant="ghost"
              size="icon"
              pressScale={1}
              whileHover={{ scale: 1 }}
              className="shrink-0 rounded-lg hover:bg-foreground/10 [&_svg]:size-5"
              aria-label="更多操作"
              title="更多操作"
            >
              <HugeiconsIcon icon={CirclePlusIcon} aria-hidden />
            </BeButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onCreateGroup}>
              <HugeiconsIcon icon={UserMultiple02Icon} aria-hidden />
              创建群聊
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onCreateApp}>
              <HugeiconsIcon icon={CirclePlusIcon} aria-hidden />
              创建应用
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRefresh}>
              <HugeiconsIcon icon={RefreshIcon} aria-hidden />
              刷新
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <GlobalSearchDialog
        open={searchOpen}
        targetId={targetId}
        theme={theme}
        mentionLabelResolver={mentionLabelResolver}
        onOpenChange={setSearchOpen}
        onSelectResult={onSelectSearchResult}
      />
    </>
  )
}
