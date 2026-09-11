import * as React from "react"
import {
  ChevronDown,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Plus,
} from "lucide-react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ProjectAvatar } from "@/components/projects/project-avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useClientData } from "@/lib/client-data-context"
import {
  createClientDocument,
  getClientDocumentPath,
  listClientDocuments,
  type ClientDocument,
  type ClientDocumentType,
} from "@/lib/document-data-api"
import { cn } from "@/lib/utils"

type SidebarDocumentNode = ClientDocument & { children: SidebarDocumentNode[] }

export function DocumentWorkspaceSidebar({
  activeDocumentId,
  activeTitle,
  onBeforeNavigate,
  projectAvatar,
  projectId,
  projectIsPersonal,
  projectName,
}: {
  activeDocumentId: string
  activeTitle: string
  onBeforeNavigate: () => boolean
  projectAvatar: string
  projectId: string
  projectIsPersonal: boolean
  projectName: string
}) {
  const navigate = useNavigate()
  const {
    loadMoreProjects,
    me,
    personalProject,
    projects,
    projectsLoadingMore,
    projectsNextCursor,
  } = useClientData()
  const [selectedProjectId, setSelectedProjectId] = React.useState(projectId)
  const [creating, setCreating] = React.useState(false)
  const [documents, setDocuments] = React.useState<SidebarDocumentNode[]>([])
  const [expandedFolderIds, setExpandedFolderIds] = React.useState<Set<string>>(
    () => new Set()
  )
  const [loading, setLoading] = React.useState(true)
  const projectOptions = React.useMemo(() => {
    const values = [
      {
        avatar: projectAvatar,
        id: projectId,
        isPersonal: projectIsPersonal,
        name: projectName,
      },
      ...(personalProject ? [personalProject] : []),
      ...projects,
    ]
    return values.filter(
      (project, index) =>
        values.findIndex((value) => value.id === project.id) === index
    )
  }, [
    personalProject,
    projectAvatar,
    projectId,
    projectIsPersonal,
    projectName,
    projects,
  ])

  const selectedProject =
    projectOptions.find((project) => project.id === selectedProjectId) ??
    projectOptions[0]!

  React.useEffect(() => {
    let cancelled = false
    void listClientDocuments(selectedProjectId)
      .then((values) => {
        if (!cancelled) {
          setDocuments(buildSidebarTree(values))
          setExpandedFolderIds(
            new Set(
              values
                .filter((value) => value.kind === "folder")
                .map((value) => value.id)
            )
          )
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "加载文档列表失败"
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedProjectId])

  async function createDocument(documentType: ClientDocumentType) {
    if (!onBeforeNavigate()) return
    setCreating(true)
    try {
      const created = await createClientDocument(selectedProjectId, {
        documentType,
        kind: "document",
        title: documentType === "markdown" ? "无标题 Markdown" : "无标题文档",
      })
      navigate(getClientDocumentPath(created.id, documentType))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建文档失败")
    } finally {
      setCreating(false)
    }
  }

  function selectProject(nextProjectId: string) {
    setDocuments([])
    setExpandedFolderIds(new Set())
    setLoading(true)
    setSelectedProjectId(nextProjectId)
  }

  function loadMoreProjectOptions() {
    void loadMoreProjects().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "加载更多项目失败")
    })
  }

  function toggleFolder(folderId: string) {
    setExpandedFolderIds((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  return (
    <aside className="hidden h-full w-72 shrink-0 flex-col overflow-hidden rounded-xl border bg-background text-foreground shadow-xs md:flex">
      <div className="mx-2 mt-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="切换项目"
              className="h-10 w-full justify-start gap-2 px-2 font-semibold"
              type="button"
              variant="ghost"
            >
              <ProjectAvatar
                className="size-7"
                project={selectedProject}
                user={me}
              />
              <span className="min-w-0 flex-1 truncate text-left">
                {selectedProject.name}
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              onValueChange={selectProject}
              value={selectedProjectId}
            >
              {projectOptions.map((project) => (
                <DropdownMenuRadioItem key={project.id} value={project.id}>
                  <ProjectAvatar
                    className="size-5"
                    project={project}
                    user={me}
                  />
                  <span className="truncate">{project.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {projectsNextCursor && (
              <DropdownMenuItem
                disabled={projectsLoadingMore}
                onSelect={(event) => {
                  event.preventDefault()
                  loadMoreProjectOptions()
                }}
              >
                {projectsLoadingMore ? "正在加载更多项目" : "加载更多项目…"}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="shrink-0 px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="新建文档"
              className="h-9 w-full bg-transparent"
              disabled={creating}
              title="新建文档"
              type="button"
              variant="outline"
            >
              {creating ? <Loader2 className="animate-spin" /> : <Plus />}
              新建文档
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onSelect={() => void createDocument("document")}>
              <FileText />
              富文本文档
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void createDocument("markdown")}>
              <FileCode2 />
              Markdown 文档
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav
        aria-label="项目文档"
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在加载
          </div>
        ) : documents.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            还没有其他文档
          </div>
        ) : (
          <DocumentTree
            activeDocumentId={activeDocumentId}
            activeTitle={activeTitle}
            depth={0}
            expandedFolderIds={expandedFolderIds}
            nodes={documents}
            onBeforeNavigate={onBeforeNavigate}
            onToggleFolder={toggleFolder}
          />
        )}
      </nav>
    </aside>
  )
}

function DocumentTree({
  activeDocumentId,
  activeTitle,
  depth,
  expandedFolderIds,
  nodes,
  onBeforeNavigate,
  onToggleFolder,
}: {
  activeDocumentId: string
  activeTitle: string
  depth: number
  expandedFolderIds: Set<string>
  nodes: SidebarDocumentNode[]
  onBeforeNavigate: () => boolean
  onToggleFolder: (folderId: string) => void
}) {
  return (
    <div role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) => {
        if (node.kind === "folder") {
          const open = expandedFolderIds.has(node.id)
          return (
            <div key={node.id}>
              <button
                aria-expanded={open}
                className="flex h-9 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                onClick={() => onToggleFolder(node.id)}
                role="treeitem"
                style={{ paddingLeft: depth * 16 + 8 }}
                type="button"
              >
                {open ? (
                  <FolderOpen className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
                ) : (
                  <Folder className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
                )}
                <span className="truncate">{node.title}</span>
              </button>
              {open && (
                <DocumentTree
                  activeDocumentId={activeDocumentId}
                  activeTitle={activeTitle}
                  depth={depth + 1}
                  expandedFolderIds={expandedFolderIds}
                  nodes={node.children}
                  onBeforeNavigate={onBeforeNavigate}
                  onToggleFolder={onToggleFolder}
                />
              )}
            </div>
          )
        }

        if (!node.documentType) return null

        return (
          <Link
            aria-current={activeDocumentId === node.id ? "page" : undefined}
            className={cn(
              "flex h-9 w-full items-center gap-2 rounded-md pr-2 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              activeDocumentId === node.id &&
                "bg-(--weui-brand-1) font-medium text-sidebar-accent-foreground hover:bg-(--weui-brand-1)"
            )}
            key={node.id}
            onClick={(event) => {
              if (!onBeforeNavigate()) event.preventDefault()
            }}
            role="treeitem"
            style={{ paddingLeft: depth * 16 + 8 }}
            to={getClientDocumentPath(node.id, node.documentType)}
          >
            {node.documentType === "markdown" ? (
              <FileCode2 className="size-4 shrink-0 text-(--weui-link)" />
            ) : (
              <FileText className="size-4 shrink-0 text-(--weui-link)" />
            )}
            <span className="truncate">
              {activeDocumentId === node.id ? activeTitle : node.title}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function buildSidebarTree(documents: ClientDocument[]): SidebarDocumentNode[] {
  const nodes = new Map<string, SidebarDocumentNode>()
  for (const document of documents) {
    nodes.set(document.id, { ...document, children: [] })
  }
  const roots: SidebarDocumentNode[] = []
  for (const document of documents) {
    const node = nodes.get(document.id)!
    const parent = document.parentId ? nodes.get(document.parentId) : undefined
    if (parent?.kind === "folder") parent.children.push(node)
    else roots.push(node)
  }
  const sort = (items: SidebarDocumentNode[]) => {
    items.sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
    )
    for (const item of items) sort(item.children)
  }
  sort(roots)
  return roots
}
