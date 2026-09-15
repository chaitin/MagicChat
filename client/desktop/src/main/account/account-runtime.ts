import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { Session } from "electron"
import type {
  DesktopContactDirectory,
  DesktopConversation,
  DesktopMessage,
} from "../../shared/account-data"
import { AuthFailure } from "../../shared/auth"
import { AccountDatabase } from "./account-database"
import { AuthenticatedClient } from "./authenticated-client"
import { ContactManager } from "./contact-manager"
import { ConversationManager } from "./conversation-manager"

export class AccountRuntime {
  private database?: AccountDatabase
  private conversationManager?: ConversationManager
  private contactManager?: ContactManager
  private initialization?: Promise<void>
  private initialized = false
  private closed = false

  constructor(
    private readonly input: {
      userDataPath: string
      serverUrl: string
      userId: string
      session: Session
      token: string
    },
  ) {}

  initialize(): Promise<void> {
    if (this.closed) return Promise.reject(new AuthFailure("account_closed", "账号数据已关闭"))
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

  close() {
    if (this.closed) return
    this.closed = true
    this.initialized = false
    this.conversationManager = undefined
    this.contactManager = undefined
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
      const results = await Promise.allSettled([
        this.conversationManager.initialize(),
        this.contactManager.initialize(),
      ])
      const failure = results.find((result) => result.status === "rejected")
      if (failure?.status === "rejected") throw failure.reason
      if (this.closed) throw new AuthFailure("account_closed", "账号数据已关闭")
      this.initialized = true
    } catch (error) {
      this.close()
      if (error instanceof AuthFailure) throw error
      throw new AuthFailure("account_initialization", "无法初始化本地账号数据")
    }
  }

  private assertInitialized() {
    if (!this.initialized || this.closed) {
      throw new AuthFailure("account_not_ready", "账号数据尚未初始化")
    }
  }
}
