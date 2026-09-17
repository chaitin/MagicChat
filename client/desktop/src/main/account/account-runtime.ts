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
  DesktopContactDirectory,
  DesktopConversation,
  DesktopMessage,
} from "../../shared/account-data"
import { AuthFailure } from "../../shared/auth"
import { AccountDatabase } from "./account-database"
import { AvatarManager } from "./avatar-manager"
import type { AvatarResource } from "./avatar-types"
import { AuthenticatedClient } from "./authenticated-client"
import { ContactManager } from "./contact-manager"
import { ConversationManager } from "./conversation-manager"
import { ProjectManager } from "./project-manager"
import { RealtimeManager, type RealtimeEvent } from "./realtime-manager"

export class AccountRuntime {
  private database?: AccountDatabase
  private conversationManager?: ConversationManager
  private contactManager?: ContactManager
  private projectManager?: ProjectManager
  private avatarManager?: AvatarManager
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
    },
  ) {}

  initialize(): Promise<void> {
    if (this.closed) return Promise.reject(new AuthFailure("account_closed", "账号数据已关闭"))
    if (this.initialized) return this.realtimeManager!.waitUntilReady()
    this.initialization ??= this.initializeOnce()
    return this.initialization
  }

  listConversations(): DesktopConversation[] {
    this.assertInitialized()
    return this.conversationManager!.listConversations()
  }

  listMessages(conversationId: string): DesktopMessage[] {
    this.assertInitialized()
    return this.conversationManager!.listMessages(conversationId)
  }

  getContacts(): DesktopContactDirectory {
    this.assertInitialized()
    return this.contactManager!.getDirectory()
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

  close() {
    if (this.closed) return
    this.closed = true
    this.initialized = false
    this.realtimeManager?.close()
    this.realtimeManager = undefined
    this.conversationManager = undefined
    this.contactManager = undefined
    this.projectManager = undefined
    this.avatarManager = undefined
    this.database?.close()
    this.database = undefined
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
      this.conversationManager = new ConversationManager(this.database, client, this.input.userId)
      this.contactManager = new ContactManager(this.database, client)
      const currentUserAvatar = {
        type: "user" as const,
        id: this.input.userId,
        name: this.input.userName,
        avatarUrl: this.input.userAvatar,
      }
      this.projectManager = new ProjectManager(client, this.contactManager, currentUserAvatar)
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
