import * as React from "react"

import {
  createPinyinSearchText,
  normalizePinyinSearchQuery,
} from "@/lib/pinyin-search"
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  Ellipsis,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import { createPortal } from "react-dom"
import { Link } from "react-router"
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getDirectorySelectionPath } from "@/components/contacts/contact-directory"
import { formatDocumentModifiedTime } from "@/lib/activity-time"
import {
  createClientDocument,
  deleteClientDocument,
  getClientDocumentPath,
  listClientDocuments,
  moveClientDocument,
  updateClientDocument,
  updateCollaborativeDocumentTitle,
  type ClientDocument,
  type ClientDocumentKind,
  type ClientDocumentType,
} from "@/lib/document-data-api"
import {
  useClientData,
  type ClientDataContextValue,
} from "@/lib/client-data-context"
import { cn } from "@/lib/utils"

type DocumentTreeNode = ClientDocument & { children: DocumentTreeNode[] }

type DocumentDropTarget =
  | { folderId: string; kind: "folder" }
  | { index: number; kind: "position"; parentId: string | null }

type CreateDocumentNode = (
  kind: ClientDocumentKind,
  parentId: string,
  documentType?: ClientDocumentType
) => void

type EditDialogState =
  | {
      documentType?: ClientDocumentType
      kind: ClientDocumentKind
      mode: "create"
      parentId: string | null
    }
  | { mode: "rename"; node: DocumentTreeNode }
  | null

export function ProjectDocumentsTab({ projectId }: { projectId: string }) {
  const { ensureUsers, usersById } = useClientData()
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [deleteNode, setDeleteNode] = React.useState<DocumentTreeNode | null>(
    null
  )
  const [storedDocumentTree, setDocumentTree] = React.useState<
    DocumentTreeNode[]
  >([])
  const documentTree = React.useMemo(
    () => hydrateDocumentTreeUsers(storedDocumentTree, usersById),
    [storedDocumentTree, usersById]
  )
  const [editDialog, setEditDialog] = React.useState<EditDialogState>(null)
  const [error, setError] = React.useState("")
  const [expandedFolderIds, setExpandedFolderIds] = React.useState<Set<string>>(
    () => new Set()
  )
  const [keyword, setKeyword] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [mutating, setMutating] = React.useState(false)
  const requestIdRef = React.useRef(0)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    })
  )

  const loadDocuments = React.useCallback(
    async (expandFolders = false) => {
      const requestId = ++requestIdRef.current
      try {
        const documents = await listClientDocuments(projectId)
        await ensureDocumentUsers(documents, ensureUsers)
        if (requestId !== requestIdRef.current) return
        const tree = buildDocumentTree(documents)
        setDocumentTree(tree)
        if (expandFolders) setExpandedFolderIds(collectFolderIds(tree))
        setError("")
      } catch (loadError) {
        if (requestId !== requestIdRef.current) return
        setError(
          loadError instanceof Error ? loadError.message : "加载文档列表失败"
        )
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    },
    [ensureUsers, projectId]
  )

  React.useEffect(() => {
    const requestId = ++requestIdRef.current
    void listClientDocuments(projectId)
      .then(async (documents) => {
        await ensureDocumentUsers(documents, ensureUsers)
        return documents
      })
      .then((documents) => {
        if (requestId === requestIdRef.current) {
          const tree = buildDocumentTree(documents)
          setDocumentTree(tree)
          setExpandedFolderIds(collectFolderIds(tree))
          setError("")
        }
      })
      .catch((loadError) => {
        if (requestId === requestIdRef.current) {
          setError(
            loadError instanceof Error ? loadError.message : "加载文档列表失败"
          )
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
    return () => {
      requestIdRef.current += 1
    }
  }, [ensureUsers, projectId])

  const normalizedKeyword = normalizePinyinSearchQuery(keyword)
  const searching = normalizedKeyword.length > 0
  const visibleTree = searching
    ? filterDocumentTree(documentTree, normalizedKeyword)
    : documentTree
  const activeNode = activeId ? findDocumentNode(documentTree, activeId) : null
  const blockedParentIds = activeNode
    ? collectDocumentNodeIds(activeNode)
    : new Set<string>()

  async function handleEditSubmit(title: string) {
    if (!editDialog) return
    setMutating(true)
    try {
      if (editDialog.mode === "create") {
        const created = await createClientDocument(
          projectId,
          editDialog.kind === "document"
            ? {
                documentType: editDialog.documentType ?? "document",
                kind: "document",
                parentId: editDialog.parentId,
                title,
              }
            : { kind: "folder", parentId: editDialog.parentId, title }
        )
        if (editDialog.parentId) {
          setExpandedFolderIds((current) =>
            new Set(current).add(editDialog.parentId as string)
          )
        }
        toast.success(created.kind === "folder" ? "目录已创建" : "文档已创建")
      } else {
        if (editDialog.node.kind === "document") {
          await updateCollaborativeDocumentTitle(editDialog.node.id, title)
        } else {
          await updateClientDocument(editDialog.node.id, { title })
        }
        toast.success("名称已更新")
      }
      setEditDialog(null)
      await loadDocuments()
    } catch (mutationError) {
      toast.error(
        mutationError instanceof Error ? mutationError.message : "操作失败"
      )
    } finally {
      setMutating(false)
    }
  }

  async function handleDelete() {
    if (!deleteNode) return
    setMutating(true)
    try {
      const result = await deleteClientDocument(deleteNode.id)
      toast.success(
        result.deletedCount > 1
          ? `已删除 ${result.deletedCount} 个节点`
          : deleteNode.kind === "folder"
            ? "目录已删除"
            : "文档已删除"
      )
      setDeleteNode(null)
      await loadDocuments()
    } catch (mutationError) {
      toast.error(
        mutationError instanceof Error ? mutationError.message : "删除失败"
      )
    } finally {
      setMutating(false)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const target = parseDocumentDropTarget(event.over?.data.current)
    const draggedId = String(event.active.id)
    setActiveId(null)
    if (!target || mutating) return

    const nextTree = moveDocumentNode(documentTree, draggedId, target)
    if (nextTree === documentTree) return
    setDocumentTree(nextTree)
    if (target.kind === "folder") {
      setExpandedFolderIds((current) => new Set(current).add(target.folderId))
    }
    setMutating(true)
    const location = flattenLocations(nextTree).get(draggedId)
    if (!location) {
      setDocumentTree(documentTree)
      return
    }
    void moveClientDocument(draggedId, {
      index: location.index,
      parentId: location.parentId,
    })
      .then(() => toast.success("文档位置已更新"))
      .catch(async (mutationError) => {
        toast.error(
          mutationError instanceof Error
            ? mutationError.message
            : "移动文档失败"
        )
        await loadDocuments()
      })
      .finally(() => setMutating(false))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/10">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4">
        <DocumentToolbar
          disabled={mutating}
          keyword={keyword}
          onCreate={(kind, documentType) =>
            setEditDialog({
              documentType,
              kind,
              mode: "create",
              parentId: null,
            })
          }
          onKeywordChange={setKeyword}
        />
        <DndContext
          collisionDetection={pointerWithin}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={handleDragEnd}
          onDragStart={(event) => setActiveId(String(event.active.id))}
          sensors={sensors}
        >
          {loading ? (
            <DocumentLoadingState />
          ) : !error && visibleTree.length === 0 ? (
            <Empty className="min-h-0 flex-1 border bg-muted p-8 shadow-xs">
              <EmptyMedia variant="icon">
                <FileText />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>
                  {searching ? "没有匹配的文档" : "还没有文档"}
                </EmptyTitle>
                <EmptyDescription>
                  {searching
                    ? "尝试使用其他关键词进行搜索"
                    : "创建一个文档开始使用"}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-background py-4 shadow-xs">
              <div className="min-w-240">
                {error ? (
                  <DocumentErrorState
                    error={error}
                    onRetry={() => void loadDocuments(true)}
                  />
                ) : (
                  <div role="tree">
                    <DocumentTree
                      activeId={activeId}
                      blockedParentIds={blockedParentIds}
                      depth={0}
                      draggingDisabled={searching || mutating}
                      expandedFolderIds={expandedFolderIds}
                      items={visibleTree}
                      onCreate={(kind, parentId, documentType) =>
                        setEditDialog({
                          documentType,
                          kind,
                          mode: "create",
                          parentId,
                        })
                      }
                      onDelete={setDeleteNode}
                      onFolderOpenChange={(folderId, open) =>
                        setExpandedFolderIds((current) => {
                          const next = new Set(current)
                          if (open) next.add(folderId)
                          else next.delete(folderId)
                          return next
                        })
                      }
                      onRename={(node) =>
                        setEditDialog({ mode: "rename", node })
                      }
                      parentId={null}
                      searching={searching}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          {typeof document !== "undefined" &&
            createPortal(
              <DragOverlay dropAnimation={null}>
                {activeNode && <DocumentDragOverlay node={activeNode} />}
              </DragOverlay>,
              document.body
            )}
        </DndContext>
      </div>
      {editDialog && (
        <DocumentEditDialog
          disabled={mutating}
          key={
            editDialog.mode === "rename"
              ? `rename:${editDialog.node.id}`
              : `create:${editDialog.kind}:${editDialog.documentType ?? "none"}:${editDialog.parentId ?? "root"}`
          }
          onOpenChange={(open) => !open && setEditDialog(null)}
          onSubmit={handleEditSubmit}
          state={editDialog}
        />
      )}
      <AlertDialog
        onOpenChange={(open) => !open && setDeleteNode(null)}
        open={deleteNode !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除{deleteNode?.kind === "folder" ? "目录" : "文档"}？
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteNode?.kind === "folder"
                ? "目录中的所有子目录和文档也会一起删除，此操作暂不支持恢复。"
                : "删除后将无法继续打开该文档，此操作暂不支持恢复。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutating}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutating}
              onClick={() => void handleDelete()}
            >
              {mutating ? "正在删除" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DocumentToolbar({
  disabled,
  keyword,
  onCreate,
  onKeywordChange,
}: {
  disabled: boolean
  keyword: string
  onCreate: (
    kind: ClientDocumentKind,
    documentType?: ClientDocumentType
  ) => void
  onKeywordChange: (keyword: string) => void
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
      <div className="relative min-w-52 sm:min-w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="搜索文档"
          className="pl-8"
          onChange={(event) => onKeywordChange(event.target.value)}
          placeholder="搜索文档"
          type="search"
          value={keyword}
        />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button disabled={disabled} type="button">
            <Plus />
            创建
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-50">
          <DropdownMenuItem onSelect={() => onCreate("document", "document")}>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300">
              <FileText className="size-4 text-sky-600 dark:text-sky-300" />
            </span>
            新建文档
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onCreate("document", "markdown")}>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300">
              <FileCode2 className="size-4" />
            </span>
            新建 Markdown 文档
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onCreate("folder")}>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300">
              <FolderPlus className="size-4 text-amber-600 dark:text-amber-300" />
            </span>
            新建目录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function DocumentTree({
  activeId,
  blockedParentIds,
  depth,
  draggingDisabled,
  expandedFolderIds,
  items,
  onCreate,
  onDelete,
  onFolderOpenChange,
  onRename,
  parentId,
  searching,
}: {
  activeId: string | null
  blockedParentIds: Set<string>
  depth: number
  draggingDisabled: boolean
  expandedFolderIds: Set<string>
  items: DocumentTreeNode[]
  onCreate: CreateDocumentNode
  onDelete: (node: DocumentTreeNode) => void
  onFolderOpenChange: (folderId: string, open: boolean) => void
  onRename: (node: DocumentTreeNode) => void
  parentId: string | null
  searching: boolean
}) {
  return (
    <>
      {items.map((node, index) => (
        <React.Fragment key={node.id}>
          <DocumentDropPosition
            depth={depth}
            disabled={
              activeId === null ||
              draggingDisabled ||
              (parentId !== null && blockedParentIds.has(parentId))
            }
            index={index}
            parentId={parentId}
          />
          <DocumentTreeItem
            activeId={activeId}
            blockedParentIds={blockedParentIds}
            depth={depth}
            draggingDisabled={draggingDisabled}
            expandedFolderIds={expandedFolderIds}
            node={node}
            onCreate={onCreate}
            onDelete={onDelete}
            onFolderOpenChange={onFolderOpenChange}
            onRename={onRename}
            rowDropTarget={
              node.kind === "folder"
                ? { folderId: node.id, kind: "folder" }
                : { index: index + 1, kind: "position", parentId }
            }
            searching={searching}
          />
        </React.Fragment>
      ))}
      <DocumentDropPosition
        depth={depth}
        disabled={
          activeId === null ||
          draggingDisabled ||
          (parentId !== null && blockedParentIds.has(parentId))
        }
        index={items.length}
        parentId={parentId}
      />
    </>
  )
}

function DocumentTreeItem(props: {
  activeId: string | null
  blockedParentIds: Set<string>
  depth: number
  draggingDisabled: boolean
  expandedFolderIds: Set<string>
  node: DocumentTreeNode
  onCreate: CreateDocumentNode
  onDelete: (node: DocumentTreeNode) => void
  onFolderOpenChange: (folderId: string, open: boolean) => void
  onRename: (node: DocumentTreeNode) => void
  rowDropTarget: DocumentDropTarget
  searching: boolean
}) {
  const { node } = props
  const open =
    node.kind === "folder" &&
    (props.searching || props.expandedFolderIds.has(node.id))
  if (node.kind === "document") {
    return (
      <DocumentTreeRow {...props} folderDropDisabled={false} open={false} />
    )
  }
  return (
    <Collapsible
      onOpenChange={(nextOpen) => {
        if (!props.searching) props.onFolderOpenChange(node.id, nextOpen)
      }}
      open={open}
    >
      <DocumentTreeRow
        {...props}
        folderDropDisabled={props.blockedParentIds.has(node.id)}
        open={open}
      />
      <CollapsibleContent role="group">
        <DocumentTree
          {...props}
          depth={props.depth + 1}
          items={node.children}
          parentId={node.id}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}

function DocumentTreeRow({
  activeId,
  depth,
  draggingDisabled,
  folderDropDisabled,
  node,
  onCreate,
  onDelete,
  onRename,
  open,
  rowDropTarget,
}: {
  activeId: string | null
  depth: number
  draggingDisabled: boolean
  folderDropDisabled: boolean
  node: DocumentTreeNode
  onCreate: CreateDocumentNode
  onDelete: (node: DocumentTreeNode) => void
  onRename: (node: DocumentTreeNode) => void
  open: boolean
  rowDropTarget: DocumentDropTarget
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef: setDragRef,
  } = useDraggable({ disabled: draggingDisabled, id: node.id })
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    data: rowDropTarget,
    disabled:
      activeId === null ||
      activeId === node.id ||
      draggingDisabled ||
      (node.kind === "folder" && folderDropDisabled),
    id: `${node.kind}:${node.id}`,
  })
  const setRowRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      setDragRef(element)
      setDropRef(element)
    },
    [setDragRef, setDropRef]
  )
  const NodeIcon =
    node.kind === "folder"
      ? open
        ? FolderOpen
        : Folder
      : node.documentType === "markdown"
        ? FileCode2
        : FileText
  const name = (
    <>
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md",
          node.kind === "folder"
            ? "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300"
            : "bg-sky-50 text-(--weui-link) dark:bg-sky-950/60 dark:text-(--weui-link)"
        )}
      >
        <NodeIcon className="size-5" />
      </span>
      <span
        className={cn(
          "min-w-0 truncate font-medium transition-colors",
          node.kind === "document" &&
            "group-focus-within/name:text-(--weui-link) group-hover/name:text-(--weui-link)"
        )}
      >
        {node.title}
      </span>
    </>
  )
  return (
    <div
      ref={setRowRef}
      {...attributes}
      {...listeners}
      aria-expanded={node.kind === "folder" ? open : undefined}
      aria-level={depth + 1}
      className={cn(
        "group flex min-h-11 w-full touch-pan-y items-center text-sm transition-colors select-none hover:bg-muted/50",
        draggingDisabled
          ? "cursor-default"
          : "cursor-grab active:cursor-grabbing",
        isDragging && "bg-muted/40 opacity-40",
        isOver &&
          "bg-sky-50 ring-1 ring-sky-300 ring-inset dark:bg-sky-950/30 dark:ring-sky-700"
      )}
      role="treeitem"
    >
      <div className="group/name flex min-w-80 flex-[2] items-center self-stretch">
        {node.kind === "folder" ? (
          <CollapsibleTrigger asChild>
            <button
              className="flex h-full max-w-full cursor-pointer items-center gap-2 rounded-sm px-4 text-left focus-visible:ring-2"
              onMouseDown={stopDocumentDragActivation}
              onPointerDown={stopDocumentDragActivation}
              onTouchStart={stopDocumentDragActivation}
              style={{ marginLeft: depth * 24 }}
              type="button"
            >
              {name}
            </button>
          </CollapsibleTrigger>
        ) : (
          <Link
            className="flex h-full max-w-full cursor-pointer items-center gap-2 rounded-sm px-4 text-left focus-visible:ring-2"
            onClick={(event) => isDragging && event.preventDefault()}
            onMouseDown={stopDocumentDragActivation}
            onPointerDown={stopDocumentDragActivation}
            onTouchStart={stopDocumentDragActivation}
            style={{ marginLeft: depth * 24 }}
            target="_blank"
            to={getClientDocumentPath(node.id, node.documentType)}
          >
            {name}
          </Link>
        )}
      </div>
      <div
        className="flex min-w-36 flex-1 cursor-default items-center self-stretch px-4 text-muted-foreground"
        onMouseDown={stopDocumentDragActivation}
        onPointerDown={stopDocumentDragActivation}
        onTouchStart={stopDocumentDragActivation}
      >
        <DocumentContributors node={node} />
      </div>
      <div
        className="flex w-52 shrink-0 cursor-default items-center self-stretch px-4 text-muted-foreground"
        onMouseDown={stopDocumentDragActivation}
        onPointerDown={stopDocumentDragActivation}
        onTouchStart={stopDocumentDragActivation}
      >
        <span className="min-w-0 flex-1 truncate text-right">
          {formatDocumentModifiedTime(node.updatedAt)}
        </span>
      </div>
      <div
        className="flex w-12 shrink-0 cursor-default items-center justify-center self-stretch"
        onMouseDown={stopDocumentDragActivation}
        onPointerDown={stopDocumentDragActivation}
        onTouchStart={stopDocumentDragActivation}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`操作${node.title}`}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {node.kind === "folder" && (
              <>
                <DropdownMenuItem
                  onSelect={() => onCreate("document", node.id, "document")}
                >
                  <FileText />
                  新建子文档
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onCreate("document", node.id, "markdown")}
                >
                  <FileCode2 />
                  新建子 Markdown 文档
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onCreate("folder", node.id)}>
                  <FolderPlus />
                  新建子目录
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={() => onRename(node)}>
              <Pencil />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => onDelete(node)}
            >
              <Trash2 />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function stopDocumentDragActivation(event: React.SyntheticEvent) {
  event.stopPropagation()
}

function DocumentContributors({ node }: { node: DocumentTreeNode }) {
  const maximumVisibleContributors = 5
  const visibleContributors = node.contributors.slice(
    0,
    maximumVisibleContributors
  )
  const hiddenCount = Math.max(
    node.contributorCount - visibleContributors.length,
    0
  )

  return (
    <div className="flex min-w-0 items-center -space-x-1.5">
      {visibleContributors.map((contributor) => {
        const displayName = contributor.nickname || contributor.name
        return (
          <Link
            aria-label={`查看协作人${displayName}`}
            className="group/contributor relative flex w-6 items-center overflow-hidden rounded-full bg-muted transition-[width] duration-150 after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:border after:border-border hover:z-10 hover:w-18 focus-visible:z-10 focus-visible:w-18 focus-visible:ring-2"
            key={contributor.id}
            title={displayName}
            to={getDirectorySelectionPath({
              id: contributor.id,
              type: "user",
            })}
          >
            <Avatar className="size-6 bg-muted ring-1 ring-background">
              <AvatarImage alt={displayName} src={contributor.avatar} />
              <AvatarFallback className="text-[8px]">
                {getInitial(displayName)}
              </AvatarFallback>
            </Avatar>
            <span className="max-w-12 min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/contributor:opacity-100 group-focus-visible/contributor:opacity-100">
              {displayName}
            </span>
          </Link>
        )
      })}
      {hiddenCount > 0 && (
        <span
          className="relative flex size-6 items-center justify-center rounded-full bg-muted text-[8px] text-muted-foreground ring-1 ring-background"
          title={`另有 ${hiddenCount} 位协作人`}
        >
          +{hiddenCount}
        </span>
      )}
    </div>
  )
}

function DocumentDropPosition({
  depth,
  disabled,
  index,
  parentId,
}: {
  depth: number
  disabled: boolean
  index: number
  parentId: string | null
}) {
  const { isOver, setNodeRef } = useDroppable({
    data: { index, kind: "position", parentId } satisfies DocumentDropTarget,
    disabled,
    id: `position:${parentId ?? "root"}:${index}`,
  })
  return (
    <div className="relative z-10 h-0">
      <div
        ref={setNodeRef}
        className={cn(
          "absolute top-0 right-3 h-3 -translate-y-1/2",
          disabled && "pointer-events-none"
        )}
        style={{ left: depth * 24 + 12 }}
      >
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 right-0 left-0 h-0.5 -translate-y-1/2 rounded-full",
            isOver && "bg-teal-500"
          )}
        />
      </div>
    </div>
  )
}

function DocumentEditDialog({
  disabled,
  onOpenChange,
  onSubmit,
  state,
}: {
  disabled: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (title: string) => Promise<void>
  state: Exclude<EditDialogState, null>
}) {
  const [title, setTitle] = React.useState(
    state.mode === "rename" ? state.node.title : ""
  )
  const kind = state.mode === "create" ? state.kind : state.node.kind
  const label = kind === "folder" ? "目录名称" : "文档标题"
  return (
    <Dialog onOpenChange={onOpenChange} open={state !== null}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state.mode === "rename"
              ? "重命名"
              : kind === "folder"
                ? "新建目录"
                : state.documentType === "markdown"
                  ? "新建 Markdown 文档"
                  : "新建文档"}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (title.trim()) void onSubmit(title)
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="document-node-title">{label}</Label>
            <Input
              autoFocus
              id="document-node-title"
              maxLength={500}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={
                kind === "folder"
                  ? "无标题目录"
                  : state.mode === "create" && state.documentType === "markdown"
                    ? "无标题 Markdown"
                    : "无标题文档"
              }
              value={title}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={disabled}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button disabled={disabled || !title.trim()} type="submit">
              {disabled ? "正在保存" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DocumentLoadingState() {
  return (
    <Empty className="min-h-0 flex-1 border bg-muted p-8 shadow-xs">
      <EmptyMedia className="text-muted-foreground" variant="icon">
        <Loader2 className="animate-spin" />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle className="text-muted-foreground">正在加载文档</EmptyTitle>
      </EmptyHeader>
    </Empty>
  )
}

function DocumentErrorState({
  error,
  onRetry,
}: {
  error: string
  onRetry: () => void
}) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <span>{error}</span>
      <Button onClick={onRetry} size="sm" variant="outline">
        重试
      </Button>
    </div>
  )
}

function DocumentDragOverlay({ node }: { node: DocumentTreeNode }) {
  const NodeIcon =
    node.kind === "folder"
      ? Folder
      : node.documentType === "markdown"
        ? FileCode2
        : FileText
  return (
    <div className="flex w-80 cursor-grabbing items-center gap-2 rounded-md border border-border/80 bg-background/95 p-2 shadow-xl ring-1 ring-black/5 backdrop-blur-sm dark:ring-white/10">
      <NodeIcon
        className={cn(
          "mr-1 size-5 shrink-0",
          node.kind === "folder"
            ? "text-amber-600 dark:text-amber-300"
            : "text-sky-600 dark:text-sky-300"
        )}
      />
      <div className="truncate text-sm font-medium">{node.title}</div>
    </div>
  )
}

async function ensureDocumentUsers(
  documents: ClientDocument[],
  ensureUsers: (userIds: string[]) => Promise<void>
) {
  const ids = new Set<string>()
  for (const document of documents) {
    ids.add(document.creator.id)
    ids.add(document.updatedBy.id)
    for (const contributor of document.contributors) ids.add(contributor.id)
  }
  await ensureUsers(Array.from(ids))
}

function hydrateDocumentTreeUsers(
  tree: DocumentTreeNode[],
  usersById: ClientDataContextValue["usersById"]
): DocumentTreeNode[] {
  const hydrateUser = (user: ClientDocument["creator"]) => {
    const profile = usersById[user.id]
    return profile
      ? {
          avatar: profile.avatar,
          id: profile.id,
          name: profile.name,
          nickname: profile.nickname,
        }
      : user
  }
  return tree.map((document) => ({
    ...document,
    children: hydrateDocumentTreeUsers(document.children, usersById),
    contributors: document.contributors.map(hydrateUser),
    creator: hydrateUser(document.creator),
    updatedBy: hydrateUser(document.updatedBy),
  }))
}

function buildDocumentTree(documents: ClientDocument[]): DocumentTreeNode[] {
  const nodes = new Map<string, DocumentTreeNode>()
  for (const document of documents)
    nodes.set(document.id, { ...document, children: [] })
  const roots: DocumentTreeNode[] = []
  for (const document of documents) {
    const node = nodes.get(document.id)!
    const parent = document.parentId ? nodes.get(document.parentId) : undefined
    if (parent?.kind === "folder") parent.children.push(node)
    else roots.push(node)
  }
  const sort = (items: DocumentTreeNode[]) => {
    items.sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
    )
    for (const item of items) sort(item.children)
  }
  sort(roots)
  return roots
}

function parseDocumentDropTarget(value: unknown): DocumentDropTarget | null {
  if (!value || typeof value !== "object" || !("kind" in value)) return null
  if (value.kind === "folder" && "folderId" in value)
    return { folderId: String(value.folderId), kind: "folder" }
  if (
    value.kind === "position" &&
    "index" in value &&
    typeof value.index === "number" &&
    "parentId" in value
  ) {
    return {
      index: value.index,
      kind: "position",
      parentId: value.parentId === null ? null : String(value.parentId),
    }
  }
  return null
}

function moveDocumentNode(
  tree: DocumentTreeNode[],
  nodeId: string,
  target: DocumentDropTarget
): DocumentTreeNode[] {
  const location = findDocumentNodeLocation(tree, nodeId)
  if (!location) return tree
  const targetParentId =
    target.kind === "folder" ? target.folderId : target.parentId
  if (
    targetParentId === nodeId ||
    (targetParentId &&
      collectDocumentNodeIds(location.node).has(targetParentId))
  )
    return tree
  let targetIndex =
    target.kind === "folder"
      ? findDocumentNode(tree, target.folderId)?.children.length
      : target.index
  if (targetIndex === undefined) return tree
  if (location.parentId === targetParentId && location.index < targetIndex)
    targetIndex -= 1
  if (location.parentId === targetParentId && location.index === targetIndex)
    return tree
  const removal = removeDocumentNode(tree, nodeId)
  if (!removal.node) return tree
  const insertion = insertDocumentNode(
    removal.tree,
    targetParentId,
    targetIndex,
    removal.node
  )
  return insertion.inserted ? insertion.tree : tree
}

function flattenLocations(
  tree: DocumentTreeNode[],
  parentId: string | null = null,
  result = new Map<string, { index: number; parentId: string | null }>()
) {
  tree.forEach((node, index) => {
    result.set(node.id, { index, parentId })
    flattenLocations(node.children, node.id, result)
  })
  return result
}

function findDocumentNode(
  tree: DocumentTreeNode[],
  id: string
): DocumentTreeNode | null {
  for (const node of tree) {
    if (node.id === id) return node
    const child = findDocumentNode(node.children, id)
    if (child) return child
  }
  return null
}

function findDocumentNodeLocation(
  tree: DocumentTreeNode[],
  id: string,
  parentId: string | null = null
): { index: number; node: DocumentTreeNode; parentId: string | null } | null {
  for (const [index, node] of tree.entries()) {
    if (node.id === id) return { index, node, parentId }
    const child = findDocumentNodeLocation(node.children, id, node.id)
    if (child) return child
  }
  return null
}

function collectFolderIds(tree: DocumentTreeNode[]): Set<string> {
  const ids = new Set<string>()
  for (const node of tree) {
    if (node.kind === "folder") ids.add(node.id)
    for (const id of collectFolderIds(node.children)) ids.add(id)
  }
  return ids
}

function collectDocumentNodeIds(node: DocumentTreeNode): Set<string> {
  const ids = new Set([node.id])
  for (const child of node.children)
    for (const id of collectDocumentNodeIds(child)) ids.add(id)
  return ids
}

function removeDocumentNode(
  tree: DocumentTreeNode[],
  id: string
): { node: DocumentTreeNode | null; tree: DocumentTreeNode[] } {
  const index = tree.findIndex((node) => node.id === id)
  if (index >= 0)
    return {
      node: tree[index] ?? null,
      tree: [...tree.slice(0, index), ...tree.slice(index + 1)],
    }
  for (const [folderIndex, node] of tree.entries()) {
    const removal = removeDocumentNode(node.children, id)
    if (!removal.node) continue
    const next = [...tree]
    next[folderIndex] = { ...node, children: removal.tree }
    return { node: removal.node, tree: next }
  }
  return { node: null, tree }
}

function insertDocumentNode(
  tree: DocumentTreeNode[],
  parentId: string | null,
  index: number,
  node: DocumentTreeNode
): { inserted: boolean; tree: DocumentTreeNode[] } {
  if (parentId === null) {
    const safe = Math.max(0, Math.min(index, tree.length))
    return {
      inserted: true,
      tree: [...tree.slice(0, safe), node, ...tree.slice(safe)],
    }
  }
  return {
    inserted: tree.some(
      (item) => item.id === parentId || containsNode(item.children, parentId)
    ),
    tree: tree.map((item) => {
      if (item.id === parentId && item.kind === "folder") {
        const safe = Math.max(0, Math.min(index, item.children.length))
        return {
          ...item,
          children: [
            ...item.children.slice(0, safe),
            node,
            ...item.children.slice(safe),
          ],
        }
      }
      const nested = insertDocumentNode(item.children, parentId, index, node)
      return nested.inserted ? { ...item, children: nested.tree } : item
    }),
  }
}

function containsNode(tree: DocumentTreeNode[], id: string): boolean {
  return tree.some((node) => node.id === id || containsNode(node.children, id))
}

function filterDocumentTree(
  tree: DocumentTreeNode[],
  keyword: string
): DocumentTreeNode[] {
  return tree.flatMap((node) => {
    const children = filterDocumentTree(node.children, keyword)
    const matches = createPinyinSearchText([
      node.title,
      node.creator.name,
      node.updatedBy.name,
      node.kind === "folder" ? "目录" : "文档",
    ]).includes(keyword)
    return matches || children.length ? [{ ...node, children }] : []
  })
}

function getInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}
