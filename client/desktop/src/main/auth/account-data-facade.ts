import type {
  AvatarRequest,
  ContactTargetInput,
  CreateGroupConversationInput,
  FriendRequestListInput,
  LocalSearchInput,
  MessageReactionUsersInput,
  OpenContactConversationInput,
  RetryMessageInput,
  SaveClientAppInput,
  SendImageMessageInput,
  SendTextMessageInput,
  SendVideoMessageInput,
  SetMessageReactionInput,
  SubmitChoiceResponseInput,
  UpdateClientAppInput,
} from "../../shared/account-data"
import type { MediaCacheRequest } from "../../shared/media"
import type { AccountRuntime } from "../account/account-runtime"

export class AccountDataFacade {
  constructor(
    private readonly awaitInitialized: () => Promise<void>,
    private readonly requireTarget: (targetId: unknown) => void,
    private readonly requireRuntime: () => AccountRuntime,
  ) {}

  async searchLocal(input: LocalSearchInput) {
    await this.ready(input?.targetId)
    return this.requireRuntime().searchLocal(input)
  }

  async listConversations(targetId: string) {
    await this.ready(targetId)
    return this.requireRuntime().listConversations()
  }

  async createGroupConversation(input: CreateGroupConversationInput) {
    await this.ready(input?.targetId)
    return this.requireRuntime().createGroupConversation(input)
  }

  async listMessages(targetId: string, conversationId: string) {
    await this.ready(targetId)
    return this.requireRuntime().listMessages(conversationId)
  }

  async loadBeforeMessages(targetId: string, conversationId: string, beforeSeq: number) {
    await this.ready(targetId)
    return this.requireRuntime().loadBeforeMessages(conversationId, beforeSeq)
  }

  async sendTextMessage(input: SendTextMessageInput) {
    await this.ready(input?.targetId)
    return this.requireRuntime().sendTextMessage(
      input.conversationId,
      input.content,
      input.bodyType,
    )
  }

  async sendFileMessage(
    input: { targetId: string; conversationId: string },
    file: { path: string; name: string; sizeBytes: number; temporary?: boolean },
  ) {
    await this.ready(input?.targetId)
    return this.requireRuntime().sendFileMessage(input.conversationId, file)
  }

  async sendImageMessage(input: SendImageMessageInput, image: { path: string; sizeBytes: number }) {
    await this.ready(input?.targetId)
    return this.requireRuntime().sendImageMessage(input.conversationId, {
      path: image.path,
      name: input.name,
      sizeBytes: image.sizeBytes,
      contentType: input.contentType,
      width: input.width,
      height: input.height,
      caption: input.caption,
    })
  }

  async sendVideoMessage(
    input: SendVideoMessageInput,
    video: {
      path: string
      name: string
      sizeBytes: number
      contentType: "video/mp4" | "video/webm"
      temporary?: boolean
    },
  ) {
    await this.ready(input?.targetId)
    return this.requireRuntime().sendVideoMessage(input.conversationId, {
      ...video,
      caption: input.caption,
    })
  }

  async retryMessage(input: RetryMessageInput) {
    await this.ready(input?.targetId)
    return this.requireRuntime().retryMessage(input.conversationId, input.clientMessageId)
  }

  async listMessageReactionUsers(input: MessageReactionUsersInput) {
    await this.ready(input?.targetId)
    return this.requireRuntime().listMessageReactionUsers(input)
  }

  async setMessageReaction(input: SetMessageReactionInput) {
    await this.ready(input?.targetId)
    return this.requireRuntime().setMessageReaction(input)
  }

  async submitChoiceResponse(input: SubmitChoiceResponseInput) {
    await this.ready(input?.targetId)
    return this.requireRuntime().submitChoiceResponse(input)
  }

  async ensureMediaCached(request: MediaCacheRequest) {
    await this.ready(request?.targetId)
    return this.requireRuntime().ensureMediaCached(request)
  }

  async checkMediaCached(request: MediaCacheRequest) {
    await this.ready(request?.targetId)
    return this.requireRuntime().checkMediaCached(request)
  }

  async getOutgoingMedia(targetId: string, clientMessageId: string) {
    await this.ready(targetId)
    return this.requireRuntime().getOutgoingMedia(clientMessageId)
  }

  async readOutgoingMedia(targetId: string, clientMessageId: string, range?: string) {
    await this.ready(targetId)
    return this.requireRuntime().readOutgoingMedia(clientMessageId, range)
  }

  async getCachedMedia(targetId: string, cacheKey: string) {
    await this.ready(targetId)
    return this.requireRuntime().getCachedMedia(cacheKey)
  }

  async getCachedMediaResource(targetId: string, cacheKey: string) {
    await this.ready(targetId)
    return this.requireRuntime().getCachedMediaResource(cacheKey)
  }

  async readCachedMedia(targetId: string, cacheKey: string, range?: string) {
    await this.ready(targetId)
    return this.requireRuntime().readCachedMedia(cacheKey, range)
  }

  async fetchTemporaryFile(targetId: string, fileId: string, range?: string) {
    await this.ready(targetId)
    return this.requireRuntime().fetchTemporaryFile(fileId, range)
  }

  async getContacts(targetId: string) {
    await this.ready(targetId)
    return this.requireRuntime().getContacts()
  }

  async refreshContacts(targetId: string) {
    await this.ready(targetId)
    return this.requireRuntime().refreshContacts()
  }

  async searchContactUsers(input: { targetId: string; query: string }) {
    await this.ready(input?.targetId)
    return this.requireRuntime().searchContactUsers(input.query)
  }

  async listFriendRequests(input: FriendRequestListInput) {
    await this.ready(input?.targetId)
    return this.requireRuntime().listFriendRequests(input)
  }

  async mutateFriendRequest(
    action: "create" | "accept" | "reject" | "cancel",
    input: ContactTargetInput,
  ) {
    await this.ready(input?.targetId)
    return this.requireRuntime().mutateFriendRequest(action, input.id)
  }

  async deleteFriend(input: ContactTargetInput) {
    await this.ready(input?.targetId)
    await this.requireRuntime().deleteFriend(input.id)
    return null
  }

  async openContactConversation(input: OpenContactConversationInput) {
    await this.ready(input?.targetId)
    return this.requireRuntime().openContactConversation(input)
  }

  async createClientApp(input: SaveClientAppInput) {
    await this.ready(input?.targetId)
    return this.requireRuntime().createClientApp(input)
  }

  async getClientApp(input: ContactTargetInput) {
    await this.ready(input?.targetId)
    return this.requireRuntime().getClientApp(input.id)
  }

  async updateClientApp(input: UpdateClientAppInput) {
    await this.ready(input?.targetId)
    return this.requireRuntime().updateClientApp(input)
  }

  async deleteClientApp(input: ContactTargetInput) {
    await this.ready(input?.targetId)
    await this.requireRuntime().deleteClientApp(input.id)
    return null
  }

  async regenerateClientAppSecret(input: ContactTargetInput) {
    await this.ready(input?.targetId)
    return this.requireRuntime().regenerateClientAppSecret(input.id)
  }

  async uploadClientAppAvatar(
    input: ContactTargetInput,
    file: { path: string; name: string; contentType: string },
  ) {
    await this.ready(input?.targetId)
    return this.requireRuntime().uploadClientAppAvatar(input.id, file)
  }

  async getAvatar(request: AvatarRequest) {
    await this.ready(request?.targetId)
    return this.requireRuntime().getAvatar({
      type: request.type,
      id: request.id,
      theme: request.theme,
    })
  }

  async invalidateAvatar(request: Omit<AvatarRequest, "theme">) {
    await this.ready(request?.targetId)
    await this.requireRuntime().invalidateAvatar(request.type, request.id)
    return null
  }

  async readAvatarResource(resourceKey: string) {
    await this.awaitInitialized()
    return this.requireRuntime().readAvatarResource(resourceKey)
  }

  async getAvatarResourceFilePath(targetId: string, resourceKey: string) {
    await this.ready(targetId)
    return this.requireRuntime().getAvatarResourceFilePath(resourceKey)
  }

  private async ready(targetId: unknown) {
    await this.awaitInitialized()
    this.requireTarget(targetId)
  }
}
