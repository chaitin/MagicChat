import * as React from "react"
import { Outlet, useNavigate } from "react-router"

import { ProjectCreateDialog } from "@/components/projects/project-create-dialog"
import { ProjectSidebar } from "@/components/projects/project-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { useClientData } from "@/lib/client-data-context"

export function ProjectsLayout() {
  const navigate = useNavigate()
  const { conversations, createProject } = useClientData()
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const groupConversations = React.useMemo(
    () => conversations.filter((conversation) => conversation.type === "group"),
    [conversations]
  )

  async function handleCreateProject(name: string, groupIds: string[]) {
    const project = await createProject(name, groupIds)
    navigate(`/projects/${encodeURIComponent(project.id)}/tasks`)
  }

  return (
    <SidebarProvider
      className="min-h-0 min-w-0 flex-1"
      style={
        {
          "--sidebar-width": "18rem",
        } as React.CSSProperties
      }
    >
      <ProjectSidebar onCreate={() => setCreateDialogOpen(true)} />
      <Outlet />
      <ProjectCreateDialog
        groups={groupConversations}
        onCreate={handleCreateProject}
        onOpenChange={setCreateDialogOpen}
        open={createDialogOpen}
      />
    </SidebarProvider>
  )
}
