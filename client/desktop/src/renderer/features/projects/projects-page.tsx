import { useEffect, useState } from "react"
import { FlashIcon, Loading03Icon } from "@hugeicons/core-free-icons"
import type {
  DesktopProjectList,
  DesktopProjectSummary,
  LocalSearchResult,
} from "../../../shared/account-data"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { SidebarSearchHeader } from "@/components/sidebar-search-header"
import type { MentionLabelResolver } from "@/lib/message-mentions"
import { Avatar } from "@/components/ui/avatar"
import { Item, ItemContent, ItemGroup } from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
export function ProjectsPage({
  targetId,
  resolvedTheme,
  mentionLabelResolver,
  onSelectSearchResult,
  onSearchResultCloseAutoFocus,
  onCreateGroup,
  onCreateApp,
}: {
  targetId: string
  resolvedTheme: "light" | "dark"
  mentionLabelResolver: MentionLabelResolver
  onSelectSearchResult: (result: LocalSearchResult) => void
  onSearchResultCloseAutoFocus: () => void
  onCreateGroup: () => void
  onCreateApp: () => void
}) {
  const [list, setList] = useState<DesktopProjectList | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let disposed = false
    setLoading(true)
    setError("")
    if (!window.desktop) {
      setError("桌面环境不可用")
      setLoading(false)
      return
    }
    void (async () => {
      try {
        const result = await window.desktop!.accountData.listProjects(targetId)
        if (disposed) return
        if (!result.ok) throw new Error(result.error.message)
        setList(result.data)
        setSelectedId((current) =>
          current && result.data.projects.some((item) => item.id === current) ? current : null,
        )
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : "读取项目失败")
      } finally {
        if (!disposed) setLoading(false)
      }
    })()
    return () => {
      disposed = true
    }
  }, [targetId, refresh])

  return (
    <section className="grid min-w-0 flex-1 grid-cols-[19rem_minmax(0,1fr)] bg-card">
      <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar">
        <SidebarSearchHeader
          searchLabel="搜索项目"
          targetId={targetId}
          theme={resolvedTheme}
          mentionLabelResolver={mentionLabelResolver}
          onSelectSearchResult={onSelectSearchResult}
          onSearchResultCloseAutoFocus={onSearchResultCloseAutoFocus}
          onCreateGroup={onCreateGroup}
          onCreateApp={onCreateApp}
          onRefresh={() => setRefresh((current) => current + 1)}
        />
        <ScrollArea
          type="hover"
          scrollHideDelay={200}
          className="min-h-0 min-w-0 flex-1 overflow-hidden bg-xgui-background-1"
          viewportClassName="overflow-x-hidden [&>div]:block! [&>div]:w-full! [&>div]:min-w-0!"
        >
          <nav className="min-h-full" aria-label="项目列表">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <HugeiconsIcon
                  icon={Loading03Icon}
                  className="size-5 animate-spin"
                  aria-label="正在读取项目"
                />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-2 p-4 text-sm text-muted-foreground">
                <p role="alert">{error}</p>
                <button
                  type="button"
                  className="text-xgui-brand"
                  onClick={() => setRefresh((current) => current + 1)}
                >
                  重试
                </button>
              </div>
            ) : list && list.projects.length > 0 ? (
              <ProjectGroup
                projects={list.projects}
                selectedId={selectedId}
                targetId={targetId}
                resolvedTheme={resolvedTheme}
                onSelect={setSelectedId}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                暂无项目
              </div>
            )}
          </nav>
        </ScrollArea>
      </aside>
      <section
        className="flex min-h-0 min-w-0 items-center justify-center bg-card"
        aria-label="项目详情"
      >
        <div className="flex flex-col items-center gap-4 text-xgui-background-2">
          <span className="flex size-32 items-center justify-center rounded-full bg-xgui-background-1">
            <HugeiconsIcon icon={FlashIcon} className="size-16" aria-hidden />
          </span>
          <p className="text-sm text-muted-foreground">项目详情即将开放</p>
        </div>
      </section>
    </section>
  )
}

function ProjectGroup({
  projects,
  selectedId,
  targetId,
  resolvedTheme,
  onSelect,
}: {
  projects: DesktopProjectSummary[]
  selectedId: string | null
  targetId: string
  resolvedTheme: "light" | "dark"
  onSelect: (id: string) => void
}) {
  return (
    <section aria-label="项目" className="px-2 py-1">
      <ItemGroup className="has-data-[size=sm]:gap-1">
        {projects.map((project) => {
          const selected = selectedId === project.id
          return (
            <Item
              key={project.id}
              asChild
              variant="default"
              size="sm"
              className={cn(
                "flex-nowrap border-transparent text-left hover:bg-foreground/5 hover:text-foreground",
                selected &&
                  "bg-xgui-brand-1 text-sidebar-accent-foreground hover:bg-xgui-brand-1 hover:text-sidebar-accent-foreground",
              )}
            >
              <button
                type="button"
                aria-current={selected ? "page" : undefined}
                onClick={() => onSelect(project.id)}
              >
                <Avatar size="lg" className="shrink-0 rounded-sm after:hidden">
                  <EntityAvatar
                    targetId={targetId}
                    type="project"
                    id={project.id}
                    theme={resolvedTheme}
                    size={40}
                    label={`${project.name}头像`}
                  />
                </Avatar>
                <ItemContent className="w-0 min-w-0">
                  <span className="block truncate text-sm leading-snug font-medium">
                    {project.name}
                  </span>
                  <span className="block truncate text-xs leading-normal text-muted-foreground">
                    {project.description || "暂无描述"}
                  </span>
                </ItemContent>
              </button>
            </Item>
          )
        })}
      </ItemGroup>
    </section>
  )
}
