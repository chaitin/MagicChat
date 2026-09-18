import type {
  AvatarRequest,
  MessageReactionUsersInput,
  RetryMessageInput,
  SendImageMessageInput,
  SendTextMessageInput,
  SendVideoMessageInput,
  SetMessageReactionInput,
} from "../../shared/account-data"
import type { MediaCacheRequest } from "../../shared/media"
import type { AccountRuntime } from "../account/account-runtime"

export class AccountDataFacade {
  constructor(
    private readonly awaitInitialized: () => Promise<void>,
    private readonly requireTarget: (targetId: unknown) => void,
    private readonly requireRuntime: () => AccountRuntime,
  ) {}

  async listConversations(targetId: string) {
    await this.ready(targetId)
    return this.requireRuntime().listConversations()
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
    file: { path: string; name: string; sizeBytes: number },
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

  async ensureMediaCached(request: MediaCacheRequest) {
    await this.ready(request?.targetId)
    return this.requireRuntime().ensureMediaCached(request)
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

  private async ready(targetId: unknown) {
    await this.awaitInitialized()
    this.requireTarget(targetId)
  }
}
