import * as React from "react"
import { Loader2 } from "lucide-react"
import { Navigate, Outlet, useNavigate, useParams } from "react-router"

import { ProjectDetailHeader } from "@/components/projects/project-detail-header"
import { ProjectNavigation } from "@/components/projects/project-navigation"
import { SidebarInset } from "@/components/ui/sidebar"
import { useClientData } from "@/lib/client-data-context"
import {
  getClientProject,
  listClientProjectMembers,
  type ClientProjectDetail,
  type ClientProjectMember,
} from "@/lib/project-data-api"
import { hydrateClientProjectMembers } from "@/lib/project-members"
import type { ProjectDetailOutletContext } from "@/pages/projects/project-detail-context"

export function ProjectDetailLayout() {
  const { projectId } = useParams<{ projectId: string }>()
  if (!projectId) return <Navigate replace to="/projects" />
  return <LoadedProjectDetail key={projectId} projectId={projectId} />
}

function LoadedProjectDetail({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const {
    conversations,
    ensureUsers,
    me,
    refreshConversations,
    refreshProjects,
    usersById,
  } = useClientData()
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [storedMembers, setMembers] = React.useState<ClientProjectMember[]>([])
  const [storedProject, setProject] = React.useState<ClientProjectDetail | null>(
    null
  )
  const members = React.useMemo(
    () => hydrateClientProjectMembers(storedMembers, usersById),
    [storedMembers, usersById]
  )
  const project = React.useMemo(() => {
    if (!storedProject) return null
    const owner = usersById[storedProject.owner.id]
    return owner
      ? {
          ...storedProject,
          owner: {
            avatar: owner.avatar,
            id: owner.id,
            name: owner.name,
            nickname: owner.nickname,
          },
        }
      : storedProject
  }, [storedProject, usersById])
  const requestIdRef = React.useRef(0)
  const groups = React.useMemo(
    () => conversations.filter((conversation) => conversation.type === "group"),
    [conversations]
  )

  const loadProject = React.useCallback(async () => {
    const requestId = ++requestIdRef.current
    try {
      const [nextProject, nextMembers] = await loadProjectDetail(
        projectId,
        ensureUsers
      )
      if (requestId === requestIdRef.current) {
        setProject(nextProject)
        setMembers(nextMembers)
        setError("")
      }
    } catch {
      // Keep the current project visible when a background refresh fails.
    }
  }, [ensureUsers, projectId])

  React.useEffect(() => {
    const requestId = ++requestIdRef.current
    void loadProjectDetail(projectId, ensureUsers)
      .then(([nextProject, nextMembers]) => {
        if (requestId === requestIdRef.current) {
          setProject(nextProject)
          setMembers(nextMembers)
        }
      })
      .catch((loadError: unknown) => {
        if (requestId === requestIdRef.current) {
          setError(
            loadError instanceof Error ? loadError.message : "加载项目详情失败"
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

  async function handleProjectDeleted() {
    navigate("/projects", { replace: true })
    await Promise.allSettled([refreshProjects()])
  }

  async function handleProjectUpdated() {
    await Promise.allSettled([loadProject(), refreshProjects()])
  }

  async function handleRelationsChanged() {
    await Promise.allSettled([
      loadProject(),
      refreshConversations(),
      refreshProjects(),
    ])
  }

  if (loading) return <ProjectPanelState loading message="正在加载项目" />
  if (error || !project) {
    return <ProjectPanelState message={error || "项目不存在或无法访问"} />
  }

  const outletContext: ProjectDetailOutletContext = {
    onProjectUpdated: handleProjectUpdated,
    project,
  }

  return (
    <SidebarInset className="min-w-0 overflow-hidden">
      <ProjectDetailHeader
        groups={groups}
        members={members}
        onProjectDeleted={handleProjectDeleted}
        onProjectUpdated={handleProjectUpdated}
        onRelationsChanged={handleRelationsChanged}
        project={project}
        user={me}
      />
      <ProjectNavigation />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Outlet context={outletContext} />
      </div>
    </SidebarInset>
  )
}

async function loadProjectDetail(
  projectId: string,
  ensureUsers: (userIds: string[]) => Promise<void>
) {
  const [project, memberPage] = await Promise.all([
    getClientProject(projectId),
    listClientProjectMembers(projectId, { limit: 3 }),
  ])
  const userIds = [
    project.owner.id,
    ...memberPage.members.map((member) => member.id),
  ]
  await ensureUsers(userIds)
  return [project, memberPage.members] as const
}

function ProjectPanelState({
  loading = false,
  message,
}: {
  loading?: boolean
  message: string
}) {
  return (
    <SidebarInset className="min-w-0 overflow-hidden bg-muted">
      <div className="flex flex-1 items-center justify-center gap-2 self-stretch text-sm text-muted-foreground">
        {loading && <Loader2 className="size-4 animate-spin" />}
        {message}
      </div>
    </SidebarInset>
  )
}
