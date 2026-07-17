import type { ClientProjectSummary } from "@/data/models"

export type ProjectListSection = {
  data: ClientProjectSummary[]
  key: "personal" | "collaboration"
}

export function buildProjectListSections({
  keyword,
  personalProject,
  projects,
}: {
  keyword: string
  personalProject: ClientProjectSummary | null
  projects: ClientProjectSummary[]
}): ProjectListSection[] {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase()
  const matchesKeyword = (project: ClientProjectSummary) =>
    normalizedKeyword.length === 0 ||
    [project.name, project.description].some((value) =>
      value.toLocaleLowerCase().includes(normalizedKeyword)
    )
  const sections: ProjectListSection[] = []

  if (personalProject && matchesKeyword(personalProject)) {
    sections.push({ data: [personalProject], key: "personal" })
  }

  const visibleProjects = projects.filter(matchesKeyword)
  if (visibleProjects.length > 0) {
    sections.push({
      data: visibleProjects,
      key: "collaboration",
    })
  }

  return sections
}
