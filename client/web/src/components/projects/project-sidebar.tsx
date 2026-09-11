import * as React from "react"

import {
  createPinyinSearchText,
  normalizePinyinSearchQuery,
} from "@/lib/pinyin-search"
import { Plus, Search } from "lucide-react"
import { useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { ProjectAvatar } from "@/components/projects/project-avatar"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { formatActivityTime } from "@/lib/activity-time"
import type { ClientUser } from "@/lib/client-data-api"
import { useClientData } from "@/lib/client-data-context"
import type { ClientProjectSummary } from "@/lib/project-data-api"

export function ProjectSidebar({ onCreate }: { onCreate: () => void }) {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId?: string }>()
  const {
    loadMoreProjects,
    me,
    personalProject,
    projects,
    projectsLoadingMore,
    projectsNextCursor,
  } = useClientData()
  const [keyword, setKeyword] = React.useState("")
  const normalizedKeyword = normalizePinyinSearchQuery(keyword)
  const visiblePersonalWorkspace = normalizedKeyword
    ? createPinyinSearchText([
        personalProject.name,
        personalProject.description,
      ]).includes(normalizedKeyword)
    : true
  const visibleProjects = normalizedKeyword
    ? projects.filter((project) =>
        createPinyinSearchText([project.name, project.description]).includes(
          normalizedKeyword
        )
      )
    : projects

  async function handleLoadMore() {
    try {
      await loadMoreProjects()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载更多项目失败")
    }
  }

  function openProject(id: string) {
    navigate(`/projects/${encodeURIComponent(id)}/tasks`)
  }

  return (
    <Sidebar className="border-r bg-background" collapsible="none">
      <SidebarHeader className="gap-0 p-0">
        <div className="flex h-14 items-center justify-between px-4">
          <h1 className="text-base font-medium">项目</h1>
          <Button
            aria-label="新建项目"
            onClick={onCreate}
            size="icon-sm"
            title="新建项目"
            type="button"
            variant="ghost"
          >
            <Plus className="size-4" />
          </Button>
        </div>
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <SidebarInput
              aria-label="搜索项目"
              className="pl-8"
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索项目"
              type="search"
              value={keyword}
            />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {visiblePersonalWorkspace && (
          <ProjectListSection>
            <ProjectListButton
              active={projectId === personalProject.id}
              onSelect={() => openProject(personalProject.id)}
              project={personalProject}
              user={me}
            />
          </ProjectListSection>
        )}
        {visibleProjects.length > 0 && (
          <ProjectListSection title="协作项目">
            {visibleProjects.map((project) => (
              <ProjectListButton
                active={projectId === project.id}
                key={project.id}
                onSelect={() => openProject(project.id)}
                project={project}
              />
            ))}
          </ProjectListSection>
        )}
        {!visiblePersonalWorkspace && visibleProjects.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            没有匹配的项目
          </div>
        )}
        {projectsNextCursor && !normalizedKeyword && (
          <div className="px-3 py-2">
            <Button
              className="w-full"
              disabled={projectsLoadingMore}
              onClick={() => void handleLoadMore()}
              variant="ghost"
            >
              {projectsLoadingMore ? "正在加载" : "加载更多"}
            </Button>
          </div>
        )}
      </SidebarContent>
    </Sidebar>
  )
}

function ProjectListSection({
  children,
  title,
}: {
  children: React.ReactNode
  title?: string
}) {
  return (
    <SidebarGroup className="py-1">
      {title && <SidebarGroupLabel>{title}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>{children}</SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function ProjectListButton({
  active,
  onSelect,
  project,
  user,
}: {
  active: boolean
  onSelect: () => void
  project: ClientProjectSummary
  user?: ClientUser
}) {
  const updatedAt = formatActivityTime(project.updatedAt)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-pressed={active}
        className="h-16 gap-3 py-2 data-active:bg-(--weui-brand-1) data-active:hover:bg-(--weui-brand-1)"
        isActive={active}
        onClick={onSelect}
        size="lg"
        type="button"
      >
        <ProjectAvatar className="size-9" project={project} user={user} />
        <span className="min-w-0 flex-1 overflow-hidden">
          <span className="flex w-full min-w-0 items-center justify-between gap-2 overflow-hidden text-sm leading-snug font-medium">
            <span className="block min-w-0 flex-1 truncate">
              {project.name}
            </span>
            {updatedAt && (
              <span className="shrink-0 pr-2 text-xs font-normal text-muted-foreground">
                {updatedAt}
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
            {project.description.trim() || "暂无说明"}
          </span>
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
