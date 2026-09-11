import * as React from "react"
import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider"
import {
  Ellipsis,
  FileCode2,
  FileText,
  Loader2,
  Send,
  Trash2,
} from "lucide-react"
import { useNavigate, useParams } from "react-router"
import { toast } from "sonner"
import * as Y from "yjs"

import { ClientDocumentTitle } from "@/components/client-document-title"
import { StandaloneCardDialog } from "@/components/conversation/send-card-dialog"
import { DocumentEditor } from "@/components/documents/document-editor"
import { DocumentWorkspaceSidebar } from "@/components/documents/document-workspace-sidebar"
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar"
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
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { getCurrentClientUser, type ClientUser } from "@/lib/client-data-api"
import {
  deleteClientDocument,
  getClientDocument,
  getClientDocumentPath,
  updateCollaborativeDocumentTitle,
  type ClientDocument,
  type ClientDocumentType,
} from "@/lib/document-data-api"
import {
  documentPresenceColor,
  normalizeDocumentPresenceUsers,
  type DocumentPresenceUser,
} from "@/lib/document-presence"
import {
  getClientProject,
  type ClientProjectDetail,
} from "@/lib/project-data-api"

const MarkdownDocumentEditor = React.lazy(() =>
  import("@/components/documents/markdown-document-editor").then((module) => ({
    default: module.MarkdownDocumentEditor,
  }))
)

const maxDocumentCardTitleLength = 256

type BodySyncState = "connecting" | "failed" | "saved" | "saving"

type LoadedDocumentState = {
  currentUser: ClientUser
  document: ClientDocument
  documentId: string
  project: ClientProjectDetail
}

export function DocumentPage() {
  const { documentId, documentType } = useParams<{
    documentId: string
    documentType: string
  }>()
  const [error, setError] = React.useState<{
    documentId: string
    message: string
  } | null>(null)
  const [loaded, setLoaded] = React.useState<LoadedDocumentState | null>(null)
  const requestedDocumentId = documentId ?? ""
  const requestedDocumentType: ClientDocumentType | null =
    documentType === "document" || documentType === "markdown"
      ? documentType
      : null

  React.useEffect(() => {
    if (!requestedDocumentId || !requestedDocumentType) return
    let cancelled = false
    void getClientDocument(requestedDocumentId)
      .then(async (nextDocument) => {
        if (
          nextDocument.kind !== "document" ||
          nextDocument.documentType !== requestedDocumentType
        ) {
          throw new Error("该节点不是可编辑文档")
        }
        const [nextProject, currentUser] = await Promise.all([
          getClientProject(nextDocument.projectId),
          getCurrentClientUser(),
        ])
        if (!cancelled) {
          setLoaded({
            currentUser,
            document: nextDocument,
            documentId: requestedDocumentId,
            project: nextProject,
          })
          setError(null)
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError({
            documentId: requestedDocumentId,
            message:
              loadError instanceof Error ? loadError.message : "加载文档失败",
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [requestedDocumentId, requestedDocumentType])

  if (!requestedDocumentId) return <DocumentNotFound message="文档 ID 不存在" />
  if (!requestedDocumentType)
    return <DocumentNotFound message="不支持该文档类型" />
  const currentError =
    error?.documentId === requestedDocumentId ? error.message : null
  if (!loaded && currentError)
    return <DocumentNotFound message={currentError} />
  if (!loaded) return <DocumentLoading />
  if (!loaded.document.documentType)
    return <DocumentNotFound message="该节点不是可编辑文档" />

  return (
    <DocumentWorkspace
      contentError={currentError}
      currentUser={loaded.currentUser}
      documentId={loaded.document.id}
      documentType={loaded.document.documentType}
      initialTitle={loaded.document.title}
      key={loaded.document.projectId}
      loading={
        (loaded.documentId !== requestedDocumentId ||
          loaded.document.documentType !== requestedDocumentType) &&
        !currentError
      }
      projectAvatar={loaded.project.avatar}
      projectId={loaded.document.projectId}
      projectIsPersonal={loaded.project.isPersonal}
      projectName={loaded.project.name}
    />
  )
}

function DocumentWorkspace({
  contentError,
  currentUser,
  documentId,
  documentType,
  initialTitle,
  loading,
  projectAvatar,
  projectId,
  projectIsPersonal,
  projectName,
}: {
  contentError: string | null
  currentUser: ClientUser
  documentId: string
  documentType: ClientDocumentType
  initialTitle: string
  loading: boolean
  projectAvatar: string
  projectId: string
  projectIsPersonal: boolean
  projectName: string
}) {
  const leaveGuardRef = React.useRef<() => boolean>(() => true)
  const [titlesByDocumentId, setTitlesByDocumentId] = React.useState<
    Record<string, string>
  >({})
  const activeTitle = titlesByDocumentId[documentId] ?? initialTitle
  const handleBeforeNavigate = React.useCallback(
    () => leaveGuardRef.current(),
    []
  )
  const handleLeaveGuardChange = React.useCallback(
    (guard: (() => boolean) | null) => {
      leaveGuardRef.current = guard ?? (() => true)
    },
    []
  )
  const handleSidebarTitleChange = React.useCallback(
    (nextTitle: string) => {
      setTitlesByDocumentId((current) =>
        current[documentId] === nextTitle
          ? current
          : { ...current, [documentId]: nextTitle }
      )
    },
    [documentId]
  )

  return (
    <main className="flex h-svh min-w-0 gap-3 overflow-hidden bg-muted p-3">
      <DocumentWorkspaceSidebar
        activeDocumentId={documentId}
        activeTitle={activeTitle}
        onBeforeNavigate={handleBeforeNavigate}
        projectAvatar={projectAvatar}
        projectId={projectId}
        projectIsPersonal={projectIsPersonal}
        projectName={projectName}
      />
      {contentError ? (
        <DocumentContentError message={contentError} />
      ) : loading ? (
        <DocumentContentLoading />
      ) : (
        <DocumentSession
          currentUser={currentUser}
          documentId={documentId}
          documentType={documentType}
          initialTitle={initialTitle}
          key={documentId}
          onLeaveGuardChange={handleLeaveGuardChange}
          onSidebarTitleChange={handleSidebarTitleChange}
          projectId={projectId}
          projectName={projectName}
        />
      )}
    </main>
  )
}

function DocumentSession({
  currentUser,
  documentId,
  documentType,
  initialTitle,
  onLeaveGuardChange,
  onSidebarTitleChange,
  projectId,
  projectName,
}: {
  currentUser: ClientUser
  documentId: string
  documentType: ClientDocumentType
  initialTitle: string
  onLeaveGuardChange: (guard: (() => boolean) | null) => void
  onSidebarTitleChange: (title: string) => void
  projectId: string
  projectName: string
}) {
  const navigate = useNavigate()
  const [collaborationDocument] = React.useState(() => new Y.Doc())
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [sendDialogOpen, setSendDialogOpen] = React.useState(false)
  const [collaborationProvider, setCollaborationProvider] =
    React.useState<HocuspocusProvider | null>(null)
  const [onlineUsers, setOnlineUsers] = React.useState<DocumentPresenceUser[]>(
    []
  )
  const collaborationUser = React.useMemo<DocumentPresenceUser>(
    () => ({
      avatar: currentUser.avatar,
      color: documentPresenceColor(currentUser.id),
      id: currentUser.id,
      name: currentUser.nickname || currentUser.name,
    }),
    [currentUser.avatar, currentUser.id, currentUser.name, currentUser.nickname]
  )
  const [bodySyncState, setBodySyncState] =
    React.useState<BodySyncState>("connecting")
  const [title, setTitle] = React.useState(initialTitle)
  const [titleSaveState, setTitleSaveState] = React.useState<
    "failed" | "pending" | "saved" | "saving"
  >("saved")
  const bodyHasSyncedRef = React.useRef(false)
  const bodyUnsyncedChangesRef = React.useRef(0)
  const mountedRef = React.useRef(true)
  const pendingSaveRef = React.useRef(false)
  const saveFailedRef = React.useRef(false)
  const savedTitleRef = React.useRef(initialTitle)
  const savingRef = React.useRef(false)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleRef = React.useRef(initialTitle)
  const untitledDocumentTitle =
    documentType === "markdown" ? "无标题 Markdown" : "无标题文档"
  const pageTitle = title.trim() || untitledDocumentTitle
  const documentCard = {
    description: `项目: ${projectName}`,
    title: createDocumentCardTitle(pageTitle, documentType),
    type: "card",
    url: getClientDocumentPath(documentId, documentType),
  } as const

  async function saveTitle() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (savingRef.current) {
      pendingSaveRef.current = true
      return
    }
    const nextTitle = titleRef.current.trim() || untitledDocumentTitle
    if (nextTitle === savedTitleRef.current) {
      saveFailedRef.current = false
      if (mountedRef.current) setTitleSaveState("saved")
      return
    }

    let saved = false
    savingRef.current = true
    saveFailedRef.current = false
    if (mountedRef.current) setTitleSaveState("saving")
    try {
      const storedTitle = await updateCollaborativeDocumentTitle(
        documentId,
        nextTitle
      )
      saved = true
      savedTitleRef.current = storedTitle
      if (mountedRef.current) {
        setTitleSaveState("saved")
        if ((titleRef.current.trim() || untitledDocumentTitle) === nextTitle) {
          titleRef.current = storedTitle
          setTitle(storedTitle)
          onSidebarTitleChange(storedTitle)
        }
      }
    } catch (error) {
      saveFailedRef.current = true
      if (mountedRef.current) {
        setTitleSaveState("failed")
        toast.error(error instanceof Error ? error.message : "保存标题失败")
      }
    } finally {
      savingRef.current = false
      if (
        pendingSaveRef.current ||
        (saved &&
          (titleRef.current.trim() || untitledDocumentTitle) !==
            savedTitleRef.current)
      ) {
        pendingSaveRef.current = false
        if (mountedRef.current) void saveTitle()
      }
    }
  }

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [documentId])

  React.useEffect(() => {
    let active = true
    const provider = new HocuspocusProvider({
      document: collaborationDocument,
      name: documentId,
      onAwarenessChange: ({ states }) => {
        if (!active) return
        setOnlineUsers(normalizeDocumentPresenceUsers(states, currentUser.id))
      },
      onAuthenticationFailed: () => {
        if (!active) return
        setBodySyncState("failed")
        toast.error("无权访问文档正文")
      },
      onStatus: ({ status }) => {
        if (!active) return
        if (status === WebSocketStatus.Connecting) {
          bodyHasSyncedRef.current = false
          setBodySyncState("connecting")
        } else if (status === WebSocketStatus.Disconnected) {
          bodyHasSyncedRef.current = false
          setBodySyncState("failed")
        }
      },
      onSynced: ({ state }) => {
        if (!active || !state) return
        bodyHasSyncedRef.current = true
        if (bodyUnsyncedChangesRef.current === 0) setBodySyncState("saved")
      },
      onUnsyncedChanges: ({ number }) => {
        if (!active) return
        bodyUnsyncedChangesRef.current = number
        setBodySyncState(
          number > 0
            ? "saving"
            : bodyHasSyncedRef.current
              ? "saved"
              : "connecting"
        )
      },
      token: "session-cookie",
      url: collaborationWebSocketURL(),
    })
    provider.setAwarenessField("user", collaborationUser)
    setCollaborationProvider(provider)

    return () => {
      active = false
      setCollaborationProvider((current) =>
        current === provider ? null : current
      )
      setOnlineUsers([])
      provider.destroy()
    }
  }, [collaborationDocument, collaborationUser, currentUser.id, documentId])

  React.useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      const dirty =
        savingRef.current ||
        saveFailedRef.current ||
        bodyUnsyncedChangesRef.current > 0 ||
        (titleRef.current.trim() || untitledDocumentTitle) !==
          savedTitleRef.current
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [untitledDocumentTitle])

  const confirmLeaveWithUnsavedTitle = React.useCallback(() => {
    const dirty =
      savingRef.current ||
      saveFailedRef.current ||
      bodyUnsyncedChangesRef.current > 0 ||
      (titleRef.current.trim() || untitledDocumentTitle) !==
        savedTitleRef.current
    return !dirty || window.confirm("文档尚未同步完成，确定要离开吗？")
  }, [untitledDocumentTitle])

  React.useEffect(() => {
    onLeaveGuardChange(confirmLeaveWithUnsavedTitle)
    return () => onLeaveGuardChange(null)
  }, [confirmLeaveWithUnsavedTitle, onLeaveGuardChange])

  function handleTitleChange(nextTitle: string) {
    titleRef.current = nextTitle
    onSidebarTitleChange(nextTitle)
    saveFailedRef.current = false
    setTitle(nextTitle)
    setTitleSaveState("pending")
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void saveTitle(), 600)
  }

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      await deleteClientDocument(documentId)
      toast.success("文档已删除")
      setDeleteOpen(false)
      navigate(`/projects/${encodeURIComponent(projectId)}/documents`, {
        replace: true,
      })
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error ? deleteError.message : "删除文档失败"
      )
    } finally {
      if (mountedRef.current) setDeleting(false)
    }
  }

  return (
    <>
      <ClientDocumentTitle title={pageTitle} disableMessageAlert />
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-teal-50/30 shadow-xs dark:bg-background/30">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4 sm:px-6">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300">
            {documentType === "markdown" ? (
              <FileCode2 className="size-5" />
            ) : (
              <FileText className="size-5" />
            )}
          </span>
          <input
            aria-label="顶部文档标题"
            className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-muted-foreground"
            onBlur={() => void saveTitle()}
            onChange={(event) => handleTitleChange(event.target.value)}
            placeholder={untitledDocumentTitle}
            value={title}
          />
          <DocumentPresence users={onlineUsers} />
          <span className="hidden shrink-0 text-xs text-muted-foreground xl:inline">
            {titleSaveState === "saving"
              ? "正在保存标题"
              : titleSaveState === "failed"
                ? "标题保存失败"
                : titleSaveState === "pending"
                  ? "标题尚未保存"
                  : "标题已自动保存"}{" "}
            ·{" "}
            {bodySyncState === "connecting"
              ? "正文连接中"
              : bodySyncState === "saving"
                ? "正文同步中"
                : bodySyncState === "failed"
                  ? "正文同步失败"
                  : "正文已同步"}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="更多文档操作"
                size="icon-sm"
                title="更多文档操作"
                type="button"
                variant="ghost"
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                disabled={deleting}
                onSelect={() => {
                  requestAnimationFrame(() => setSendDialogOpen(true))
                }}
              >
                <Send />
                发送到对话
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={deleting}
                onSelect={() => setDeleteOpen(true)}
                variant="destructive"
              >
                <Trash2 />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <StandaloneCardDialog
            card={documentCard}
            onOpenChange={setSendDialogOpen}
            open={sendDialogOpen}
          />
          <AlertDialog
            onOpenChange={(open) => {
              if (!deleting) setDeleteOpen(open)
            }}
            open={deleteOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除文档</AlertDialogTitle>
                <AlertDialogDescription>
                  {`确定删除“${pageTitle}”吗？此操作无法撤销。`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleting}
                  onClick={(event) => {
                    event.preventDefault()
                    void handleDelete()
                  }}
                  variant="destructive"
                >
                  {deleting && <Loader2 className="animate-spin" />}
                  删除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </header>
        {collaborationProvider ? (
          documentType === "markdown" ? (
            <React.Suspense
              fallback={
                <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  正在加载 Markdown 编辑器
                </div>
              }
            >
              <MarkdownDocumentEditor
                collaborationDocument={collaborationDocument}
                collaborationProvider={collaborationProvider}
                onTitleBlur={() => void saveTitle()}
                onTitleChange={handleTitleChange}
                title={title}
              />
            </React.Suspense>
          ) : (
            <DocumentEditor
              collaborationDocument={collaborationDocument}
              collaborationProvider={collaborationProvider}
              collaborationUser={collaborationUser}
              onTitleBlur={() => void saveTitle()}
              onTitleChange={handleTitleChange}
              title={title}
            />
          )
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在连接协作文档
          </div>
        )}
      </section>
    </>
  )
}

function DocumentPresence({ users }: { users: DocumentPresenceUser[] }) {
  if (users.length === 0) return null
  const maximumVisibleUsers = 5
  const visibleUsers = users.slice(0, maximumVisibleUsers)
  const hiddenCount = Math.max(users.length - visibleUsers.length, 0)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`${users.length} 人正在查看文档`}
          className="flex shrink-0 items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:outline-none"
          type="button"
        >
          <AvatarGroup>
            {visibleUsers.map((user) => (
              <Avatar key={user.id} size="sm" title={`${user.name} 正在查看`}>
                <AvatarImage alt={user.name} src={user.avatar} />
                <AvatarFallback>{getPresenceInitial(user.name)}</AvatarFallback>
                <AvatarBadge className="bg-emerald-500" />
              </Avatar>
            ))}
            {hiddenCount > 0 && (
              <AvatarGroupCount className="text-[10px]">
                +{hiddenCount}
              </AvatarGroupCount>
            )}
          </AvatarGroup>
          <span className="hidden text-xs whitespace-nowrap text-muted-foreground 2xl:inline">
            {users.length} 人正在查看
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          正在查看 · {users.length} 人
        </p>
        <div className="max-h-72 overflow-y-auto">
          {users.map((user) => (
            <div
              className="flex items-center gap-2 rounded-md px-2 py-1.5"
              key={user.id}
            >
              <Avatar size="sm">
                <AvatarImage alt={user.name} src={user.avatar} />
                <AvatarFallback>{getPresenceInitial(user.name)}</AvatarFallback>
                <AvatarBadge className="bg-emerald-500" />
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm">
                {user.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                在线
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function getPresenceInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}

function collaborationWebSocketURL() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${window.location.host}/api/client/document/collaboration`
}

function createDocumentCardTitle(
  title: string,
  documentType: ClientDocumentType
) {
  const prefix = documentType === "markdown" ? "Markdown 文档 - " : "文档 - "
  const characters = Array.from(title.trim())
  const remaining = maxDocumentCardTitleLength - Array.from(prefix).length
  if (characters.length <= remaining) return prefix + characters.join("")
  return prefix + characters.slice(0, remaining - 1).join("") + "…"
}

function DocumentContentLoading() {
  return (
    <>
      <ClientDocumentTitle title="正在加载文档" disableMessageAlert />
      <section className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border bg-background text-sm text-muted-foreground shadow-xs">
        <Loader2 className="size-4 animate-spin" />
        正在加载文档
      </section>
    </>
  )
}

function DocumentContentError({ message }: { message: string }) {
  return (
    <>
      <ClientDocumentTitle title="文档不存在" disableMessageAlert />
      <section className="flex min-w-0 flex-1 items-center justify-center rounded-xl border bg-background p-6 shadow-xs">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">文档不存在</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        </div>
      </section>
    </>
  )
}

function DocumentLoading() {
  return (
    <main className="flex min-h-svh items-center justify-center gap-2 bg-muted/30 text-sm text-muted-foreground">
      <ClientDocumentTitle title="正在加载文档" disableMessageAlert />
      <Loader2 className="size-4 animate-spin" />
      正在加载文档
    </main>
  )
}

function DocumentNotFound({ message }: { message?: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <ClientDocumentTitle title="文档不存在" disableMessageAlert />
      <div className="max-w-sm rounded-lg border bg-background p-8 text-center shadow-xs">
        <h1 className="text-lg font-semibold">文档不存在</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {message || "该文档不存在，或者当前账号无权访问。"}
        </p>
      </div>
    </main>
  )
}
