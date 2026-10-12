import { AuthFailure, isRecord } from "../../shared/auth.ts"
import type { DesktopProjectList, DesktopProjectSummary } from "../../shared/account-data"
import type { AuthenticatedClient } from "./authenticated-client"
import type { AvatarDescriptor } from "./avatar-types"
import type { ContactManager } from "./contact-manager"
import { retryNetworkAction } from "./retry.ts"

export class ProjectManager {
  private readonly client: AuthenticatedClient
  private readonly contacts: ContactManager
  private readonly currentUser: AvatarDescriptor

  constructor(
    client: AuthenticatedClient,
    contacts: ContactManager,
    currentUser: AvatarDescriptor,
  ) {
    this.client = client
    this.contacts = contacts
    this.currentUser = currentUser
  }

  async listBindableProjects(): Promise<DesktopProjectSummary[]> {
    return (await this.listProjects()).projects
  }

  async listProjects(): Promise<DesktopProjectList> {
    const projects: DesktopProjectSummary[] = []
    let personalProject: DesktopProjectSummary | null = null
    const seenCursors = new Set<string>()
    let cursor: string | null = null
    do {
      const data = await this.client.get(
        `/api/client/projects?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      )
      if (
        !isRecord(data) ||
        !Array.isArray(data.projects) ||
        (data.next_cursor !== null &&
          data.next_cursor !== undefined &&
          typeof data.next_cursor !== "string")
      ) {
        throw new AuthFailure("invalid_response", "项目列表响应格式不正确")
      }
      if (!cursor && isRecord(data.personal_project) && data.personal_project.id) {
        personalProject = projectSummary(data.personal_project)
        if (data.personal_project.is_personal !== true) {
          throw new AuthFailure("invalid_response", "个人项目响应格式不正确")
        }
      }
      for (const project of data.projects) {
        const summary = projectSummary(project)
        if (!isRecord(project) || typeof project.is_personal !== "boolean") {
          throw new AuthFailure("invalid_response", "项目列表响应格式不正确")
        }
        if (!project.is_personal) projects.push(summary)
      }
      cursor = data.next_cursor ?? null
      if (cursor && (!data.projects.length || seenCursors.has(cursor))) {
        throw new AuthFailure("invalid_response", "项目列表分页格式不正确")
      }
      if (cursor) seenCursors.add(cursor)
    } while (cursor)
    return { personalProject, projects }
  }

  getAvatarDescriptor(projectId: string): Promise<AvatarDescriptor> {
    return retryNetworkAction(async () => {
      const data = await this.client.get(`/api/client/projects/${encodeURIComponent(projectId)}`)
      if (!isRecord(data) || data.id !== projectId) {
        throw new AuthFailure("invalid_response", "项目头像响应格式不正确")
      }
      const personalAvatar =
        data.is_personal === true
          ? await this.contacts
              .refreshAvatarDescriptor("user", this.currentUser.id)
              .catch(() => this.currentUser)
          : undefined
      return {
        type: "project",
        id: projectId,
        name: optionalString(data.name, 256),
        avatarUrl: personalAvatar?.avatarUrl ?? optionalString(data.avatar, 4_096),
      }
    })
  }
}

function projectSummary(value: unknown): DesktopProjectSummary {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 128 ||
    typeof value.name !== "string" ||
    !value.name ||
    value.name.length > 256
  ) {
    throw new AuthFailure("invalid_response", "项目列表响应格式不正确")
  }
  return {
    id: value.id,
    name: value.name,
    description: typeof value.description === "string" ? value.description : "",
  }
}

function optionalString(value: unknown, maximum: number): string {
  return typeof value === "string" && value.length <= maximum ? value : ""
}
