import { useOutletContext } from "react-router"

import type { ClientProjectDetail } from "@/lib/project-data-api"

export type ProjectDetailOutletContext = {
  onProjectUpdated: () => Promise<void>
  project: ClientProjectDetail
}

export function useProjectDetail() {
  return useOutletContext<ProjectDetailOutletContext>()
}
