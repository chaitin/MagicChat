import { AuthFailure, isRecord } from "../../shared/auth"
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
