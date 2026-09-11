import { NavLink, useParams } from "react-router"

import { cn } from "@/lib/utils"

const projectSections = [
  { label: "任务", path: "tasks" },
  { label: "目标", path: "goals" },
  { label: "文档", path: "documents" },
  { label: "成员", path: "members" },
]

export function ProjectNavigation() {
  const { projectId = "" } = useParams<{ projectId: string }>()

  return (
    <nav
      aria-label="项目内容"
      className="flex h-10 shrink-0 items-end gap-1 border-b px-4"
    >
      {projectSections.map((section) => (
        <NavLink
          className={({ isActive }) =>
            cn(
              "relative inline-flex h-9 items-center justify-center rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none dark:text-muted-foreground dark:hover:text-foreground",
              isActive && "text-foreground after:opacity-100"
            )
          }
          key={section.path}
          to={`/projects/${encodeURIComponent(projectId)}/${section.path}`}
        >
          {section.label}
        </NavLink>
      ))}
    </nav>
  )
}
