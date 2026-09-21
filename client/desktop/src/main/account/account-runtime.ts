import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { Session } from "electron"
import type {
  AvatarRequest,
  AccountDataChangedEvent,
  AccountDataDomain,
  AccountDataSyncEvent,
  AvatarResult,
  CreateGroupConversationInput,
  DesktopContactDirectory,
  DesktopConversation,
  DesktopMessage,
  DesktopMessagePage,
  FriendRequestListInput,
  MessageReactionUsersInput,
  OpenContactConversationInput,
  SaveClientAppInput,
  SetMessageReactionInput,
  UpdateClientAppInput,
} from "../../shared/account-data"
import { AuthFailure } from "../../shared/auth"
import type { CachedMedia, MediaCacheRequest, MediaDownloadProgress } from "../../shared/media"
import { AccountDatabase } from "./account-database"
import { AvatarManager } from "./avatar-manager"
import type { AvatarResource } from "./avatar-types"
import { AuthenticatedClient } from "./authenticated-client"
import { ClientAppManager } from "./client-app-manager"
import { ContactManager } from "./contact-manager"
import { ConversationManager } from "./conversation-manager"
import { MediaManager } from "./media-manager"
import { ProjectManager } from "./project-manager"
import { RealtimeManager, type RealtimeEvent } from "./realtime-manager"

export class AccountRuntime {
  private database?: AccountDatabase
  private client?: AuthenticatedClient
  private conversationManager?: ConversationManager
  private contactManager?: ContactManager
  private clientAppManager?: ClientAppManager
  private projectManager?: ProjectManager
  private avatarManager?: AvatarManager
  private mediaManager?: MediaManager
  private realtimeManager?: RealtimeManager
  private initialization?: Promise<void>
  private revision = 0
  private initialized = false
  private closed = false

  constructor(
    private readonly input: {
      userDataPath: string
      targetId: string
      serverUrl: string
      userId: string
      userName: string
      userAvatar: string
      session: Session
      token: string
      onSyncStateChange: (event: AccountDataSyncEvent) => void
      onDataChanged: (event: AccountDataChangedEvent) => void
      onMediaProgress: (event: MediaDownloadProgress) => void
    },
  ) {}

  initialize(): Promise<void> {
    if (this.closed) return Promise.reject(new AuthFailure("account_closed", "账号数据已关闭"))
    if (this.initialized) return this.realtimeManager!.waitUntilReady()
    this.initialization ??= this.initializeOnce()
    return this.initialization
  }

  async refreshAll() {
    this.assertInitialized()
    await this.synchronize()
  }

  listConversations(): DesktopConversation[] {
    this.assertInitialized()
    return this.conversationManager!.listConversations()
  }

  async createGroupConversation(input: CreateGroupConversationInput) {
    this.assertInitialized()
    const conversation = await this.conversationManager!.createGroupConversation(input)
    this.notifyChanged(["conversations"], [conversation.id])
    return conversation
  }

  listMessages(conversationId: string): DesktopMessage[] {
    this.assertInitialized()
    return this.conversationManager!.listMessages(conversationId)
  }

  loadBeforeMessages(conversationId: string, beforeSeq: number): Promise<DesktopMessagePage> {
    this.assertInitialized()
    return this.conversationManager!.loadBeforeMessages(conversationId, beforeSeq)
  }

  sendTextMessage(conversationId: string, content: string, bodyType: "text" | "markdown") {
    this.assertInitialized()
    return this.conversationManager!.sendTextMessage(conversationId, content, bodyType)
  }

  sendFileMessage(
    conversationId: string,
    file: { path: string; name: string; sizeBytes: number; temporary?: boolean },
  ) {
    this.assertInitialized()
    return this.conversationManager!.sendFileMessage(conversationId, file)
  }

  sendImageMessage(
    conversationId: string,
    image: {
      path: string
      name: string
      sizeBytes: number
      contentType: "image/webp" | "image/png"
      width: number
      height: number
      caption: string
    },
  ) {
    this.assertInitialized()
    return this.conversationManager!.sendImageMessage(conversationId, image)
  }

  sendVideoMessage(
    conversationId: string,
    video: {
      path: string
      name: string
      sizeBytes: number
      contentType: "video/mp4" | "video/webm"
      temporary?: boolean
      caption: string
    },
  ) {
    this.assertInitialized()
    return this.conversationManager!.sendVideoMessage(conversationId, video)
  }

  readOutgoingMedia(clientMessageId: string, range?: string) {
    this.assertInitialized()
    return this.conversationManager!.readOutgoingMedia(clientMessageId, range)
  }

  getOutgoingMedia(clientMessageId: string) {
    this.assertInitialized()
    return this.conversationManager!.getOutgoingMedia(clientMessageId)
  }

  retryMessage(conversationId: string, clientMessageId: string) {
    this.assertInitialized()
    return this.conversationManager!.retryMessage(conversationId, clientMessageId)
  }

  listMessageReactionUsers(input: Omit<MessageReactionUsersInput, "targetId">) {
    this.assertInitialized()
    return this.conversationManager!.listMessageReactionUsers(input)
  }

  async setMessageReaction(input: Omit<SetMessageReactionInput, "targetId">) {
    this.assertInitialized()
    const messages = await this.conversationManager!.setMessageReaction(input)
    this.notifyChanged(["messages"], [input.conversationId])
    return messages
  }

  async ensureMediaCached(request: MediaCacheRequest): Promise<CachedMedia> {
    this.assertInitialized()
    return this.mediaManager!.ensureCached(request)
  }

  async getCachedMedia(cacheKey: string): Promise<CachedMedia> {
    this.assertInitialized()
    return this.mediaManager!.getCached(cacheKey)
  }

  async getCachedMediaResource(cacheKey: string) {
    this.assertInitialized()
    return this.mediaManager!.getCachedResource(cacheKey)
  }

  async readCachedMedia(cacheKey: string, range?: string): Promise<Response> {
    this.assertInitialized()
    return this.mediaManager!.createResourceResponse(cacheKey, range)
  }

  async fetchTemporaryFile(
    fileId: string,
    range?: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    this.assertInitialized()
    if (!fileId || fileId.length > 128) {
      throw new AuthFailure("invalid_file_id", "文件标识不正确")
    }
    const data = await this.client!.post("/api/client/temporary-files/read-urls", {
      file_ids: [fileId],
    })
    if (!data || typeof data !== "object" || !Array.isArray((data as { urls?: unknown }).urls)) {
      throw new AuthFailure("invalid_response", "文件访问地址响应格式不正确")
    }
    const value = (data as { urls: unknown[] }).urls[0]
    if (
      !value ||
      typeof value !== "object" ||
      typeof (value as { url?: unknown }).url !== "string"
    ) {
      throw new AuthFailure("invalid_response", "文件访问地址响应格式不正确")
    }
    const url = new URL((value as { url: string }).url, `${this.input.serverUrl}/`)
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new AuthFailure("invalid_response", "文件访问地址格式不正确")
    }
    return this.input.session.fetch(url.toString(), {
      headers: range ? { Range: range } : undefined,
      credentials: "omit",
      signal,
    })
  }

  getContacts(): DesktopContactDirectory {
    this.assertInitialized()
    return this.contactManager!.getDirectory()
  }

  async refreshContacts() {
    this.assertInitialized()
    const directory = await this.contactManager!.refreshAndGetDirectory()
    this.notifyChanged(["contacts"], [])
    return directory
  }

  searchContactUsers(query: string) {
    this.assertInitialized()
    return this.contactManager!.searchUsers(query)
  }

  listFriendRequests(input: FriendRequestListInput) {
    this.assertInitialized()
    return this.contactManager!.listFriendRequests(input.direction)
  }

  async mutateFriendRequest(action: "create" | "accept" | "reject" | "cancel", id: string) {
    this.assertInitialized()
    const manager = this.contactManager!
    const request =
      action === "create"
        ? await manager.createFriendRequest(id)
        : action === "accept"
          ? await manager.acceptFriendRequest(id)
          : action === "reject"
            ? await manager.rejectFriendRequest(id)
            : await manager.cancelFriendRequest(id)
    if (action === "create" || action === "accept") await manager.refresh()
    this.notifyChanged(["contacts"], [])
    return request
  }

  async deleteFriend(userId: string) {
    this.assertInitialized()
    await this.contactManager!.deleteFriend(userId)
    this.notifyChanged(["contacts"], [])
  }

  async openContactConversation(input: Omit<OpenContactConversationInput, "targetId">) {
    this.assertInitialized()
    const conversation = await this.conversationManager!.openContactConversation(input)
    this.notifyChanged(["conversations"], [conversation.id])
    return conversation
  }

  async createClientApp(input: SaveClientAppInput) {
    this.assertInitialized()
    const result = await this.clientAppManager!.create(input)
    this.notifyChanged(["contacts"], [])
    return result
  }

  getClientApp(appId: string) {
    this.assertInitialized()
    return this.clientAppManager!.get(appId)
  }

  async updateClientApp(input: UpdateClientAppInput) {
    this.assertInitialized()
    const result = await this.clientAppManager!.update(input)
    this.notifyChanged(["contacts"], [])
    return result
  }

  async deleteClientApp(appId: string) {
    this.assertInitialized()
    await this.clientAppManager!.delete(appId)
    this.notifyChanged(["contacts", "conversations"], [])
  }

  regenerateClientAppSecret(appId: string) {
    this.assertInitialized()
    return this.clientAppManager!.regenerateSecret(appId)
  }

  async uploadClientAppAvatar(
    appId: string,
    file: { path: string; name: string; contentType: string },
  ) {
    this.assertInitialized()
    const app = await this.clientAppManager!.uploadAvatar(appId, file)
    this.notifyChanged(["contacts"], [])
    return app
  }

  getAvatar(request: Omit<AvatarRequest, "targetId">): Promise<AvatarResult> {
    this.assertInitialized()
    return this.avatarManager!.getAvatar(request)
  }

  async invalidateAvatar(type: AvatarRequest["type"], entityId: string) {
    this.assertInitialized()
    await this.avatarManager!.invalidate(type, entityId)
  }

  async readAvatarResource(resourceKey: string): Promise<AvatarResource> {
    this.assertInitialized()
    return this.avatarManager!.readResource(resourceKey)
  }

  getAvatarResourceFilePath(resourceKey: string): string {
    this.assertInitialized()
    return this.avatarManager!.getResourceFilePath(resourceKey)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.initialized = false
    this.realtimeManager?.close()
    this.realtimeManager = undefined
    this.mediaManager?.close()
    this.mediaManager = undefined
    this.conversationManager?.close()
    this.conversationManager = undefined
    this.contactManager = undefined
    this.clientAppManager = undefined
    this.projectManager = undefined
    this.avatarManager = undefined
    this.database?.close()
    this.database = undefined
    this.client = undefined
  }

  private async initializeOnce() {
    try {
      const accountKey = createHash("sha256")
        .update(this.input.serverUrl)
        .update("\0")
        .update(this.input.userId)
        .digest("hex")
      const accountDirectory = path.join(this.input.userDataPath, "accounts", accountKey)
      await mkdir(accountDirectory, { recursive: true })
      this.database = new AccountDatabase(path.join(accountDirectory, "chat.sqlite"))
      const client = new AuthenticatedClient(
        this.input.serverUrl,
        this.input.session,
        this.input.token,
      )
      this.client = client
      this.conversationManager = new ConversationManager(
        this.database,
        client,
        this.input.userId,
        this.input.userName,
        (conversationId) => this.notifyChanged(["conversations", "messages"], [conversationId]),
      )
      this.contactManager = new ContactManager(this.database, client)
      this.clientAppManager = new ClientAppManager(client, this.contactManager)
      const currentUserAvatar = {
        type: "user" as const,
        id: this.input.userId,
        name: this.input.userName,
        avatarUrl: this.input.userAvatar,
      }
      this.projectManager = new ProjectManager(client, this.contactManager, currentUserAvatar)
      this.mediaManager = new MediaManager(
        accountDirectory,
        `${this.input.serverUrl}\0${this.input.userId}`,
        this.database,
        (fileId, signal) => this.fetchTemporaryFile(fileId, undefined, signal),
        this.input.onMediaProgress,
      )
      await this.mediaManager.initialize()
      this.avatarManager = new AvatarManager(
        accountDirectory,
        this.input.serverUrl,
        this.database,
        client,
        this.conversationManager,
        this.contactManager,
        this.projectManager,
        currentUserAvatar,
      )
      this.realtimeManager = new RealtimeManager({
        serverUrl: this.input.serverUrl,
        token: this.input.token,
        synchronize: () => this.synchronize(),
        applyEvent: (event) => this.applyRealtimeEvent(event),
        onStateChange: (state) =>
          this.input.onSyncStateChange({ targetId: this.input.targetId, state }),
      })
      await this.realtimeManager.start()
      if (this.closed) throw new AuthFailure("account_closed", "账号数据已关闭")
      this.initialized = true
    } catch (error) {
      this.close()
      if (error instanceof AuthFailure) throw error
      throw new AuthFailure("account_initialization", "无法初始化本地账号数据")
    }
  }

  private async synchronize() {
    const results = await Promise.allSettled([
      this.conversationManager!.refresh(),
      this.contactManager!.refresh(),
    ])
    const failure = results.find((result) => result.status === "rejected")
    if (failure?.status === "rejected") throw failure.reason
    if (this.closed) throw new AuthFailure("account_closed", "账号数据已关闭")
    this.notifyChanged(["conversations", "messages", "contacts"], [])
  }

  private async applyRealtimeEvent(event: RealtimeEvent) {
    const conversationChange = await this.conversationManager!.applyRealtimeEvent(
      event.name,
      event.payload,
    )
    if (this.closed) return
    if (conversationChange) {
      const domains: AccountDataDomain[] = ["conversations"]
      if (conversationChange.messages) domains.push("messages")
      this.notifyChanged(domains, conversationChange.conversationIds)
      return
    }
    if (await this.contactManager!.applyRealtimeEvent(event.name, event.payload)) {
      if (this.closed) return
      this.notifyChanged(["contacts"], [])
    }
  }

  private notifyChanged(domains: AccountDataDomain[], conversationIds: string[]) {
    this.revision += 1
    this.input.onDataChanged({
      targetId: this.input.targetId,
      revision: this.revision,
      domains,
      conversationIds,
    })
  }

  private assertInitialized() {
    if (!this.initialized || this.closed) {
      throw new AuthFailure("account_not_ready", "账号数据尚未初始化")
    }
  }
}
