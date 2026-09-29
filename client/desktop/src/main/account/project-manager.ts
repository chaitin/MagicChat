import { AuthFailure, isRecord } from "../../shared/auth"
import type { DesktopProjectSummary } from "../../shared/account-data"
import { AuthenticatedClient } from "./authenticated-client"
import type { AvatarDescriptor } from "./avatar-types"
import { ContactManager } from "./contact-manager"
import { retryNetworkAction } from "./retry"

export class ProjectManager {
  constructor(
    private readonly client: AuthenticatedClient,
    private readonly contacts: ContactManager,
    private readonly currentUser: AvatarDescriptor,
  ) {}

  async listBindableProjects(): Promise<DesktopProjectSummary[]> {
    const projects: DesktopProjectSummary[] = []
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
      for (const project of data.projects) {
        if (
          !isRecord(project) ||
          typeof project.id !== "string" ||
          !project.id ||
          project.id.length > 128 ||
          typeof project.name !== "string" ||
          !project.name ||
          project.name.length > 256 ||
          typeof project.is_personal !== "boolean"
        ) {
          throw new AuthFailure("invalid_response", "项目列表响应格式不正确")
        }
        if (!project.is_personal)
          projects.push({
            id: project.id,
            name: project.name,
            description: typeof project.description === "string" ? project.description : "",
          })
      }
      cursor = data.next_cursor ?? null
      if (cursor && (!data.projects.length || seenCursors.has(cursor))) {
        throw new AuthFailure("invalid_response", "项目列表分页格式不正确")
      }
      if (cursor) seenCursors.add(cursor)
    } while (cursor)
    return projects
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

function optionalString(value: unknown, maximum: number): string {
  return typeof value === "string" && value.length <= maximum ? value : ""
}
