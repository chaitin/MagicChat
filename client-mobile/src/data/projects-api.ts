import { ApiRequestError, createApiClient, type ApiFetch } from "@/data/api-client"
import type {
  ClientProjectPage,
  ClientProjectSummary,
} from "@/data/models"

type ProjectSummaryResponse = {
  avatar?: string
  description?: string
  id?: string
  is_personal?: boolean
  name?: string
  updated_at?: string
}

type ProjectListResponse = {
  next_cursor?: string | null
  personal_project?: ProjectSummaryResponse
  projects?: ProjectSummaryResponse[]
}

export async function fetchProjects(
  serverUrl: string,
  input: { cursor?: string; limit: number },
  options: { fetcher?: ApiFetch; signal?: AbortSignal } = {}
): Promise<ClientProjectPage> {
  const query = new URLSearchParams({ limit: String(input.limit) })
  if (input.cursor) {
    query.set("cursor", input.cursor)
  }

  const data = await createApiClient(serverUrl, options.fetcher).request<
    ProjectListResponse
  >(`/api/client/projects?${query.toString()}`, {
    errorMessage: "加载项目列表失败",
    method: "GET",
    signal: options.signal,
  })

  if (
    !data?.personal_project ||
    !Array.isArray(data.projects) ||
    (data.next_cursor !== null &&
      data.next_cursor !== undefined &&
      typeof data.next_cursor !== "string")
  ) {
    throw new ApiRequestError("项目列表响应格式不正确")
  }

  return {
    nextCursor: data.next_cursor ?? null,
    personalProject: normalizeProjectSummary(data.personal_project),
    projects: data.projects.map(normalizeProjectSummary),
  }
}

function normalizeProjectSummary(
  project: ProjectSummaryResponse
): ClientProjectSummary {
  if (
    typeof project.id !== "string" ||
    typeof project.name !== "string" ||
    typeof project.updated_at !== "string" ||
    typeof project.is_personal !== "boolean"
  ) {
    throw new ApiRequestError("项目摘要响应格式不正确")
  }

  return {
    avatar: typeof project.avatar === "string" ? project.avatar : "",
    description:
      typeof project.description === "string" ? project.description : "",
    id: project.id,
    isPersonal: project.is_personal,
    name: project.name,
    updatedAt: project.updated_at,
  }
}
