import { DatabaseSync } from "node:sqlite"
import type { DesktopContactDirectory, DesktopConversation } from "../../shared/account-data"
import type { AvatarCacheRecord } from "./avatar-types"
import { CacheRepository, type StoredMediaCache } from "./database/cache-repository"
import {
  ContactRepository,
  type StoredContactApp,
  type StoredContactGroup,
  type StoredContactUser,
} from "./database/contact-repository"
import { ConversationRepository, type StoredConversation } from "./database/conversation-repository"
import { initializeAccountSchema } from "./database/account-schema"
import { MessageRepository } from "./database/message-repository"
import { SearchRepository } from "./database/search-repository"

export type { StoredConversation } from "./database/conversation-repository"
export type { StoredMessage } from "./database/message-repository"
export type {
  StoredContactApp,
  StoredContactGroup,
  StoredContactUser,
} from "./database/contact-repository"
export type { StoredMediaCache } from "./database/cache-repository"

export class AccountDatabase {
  private readonly database: DatabaseSync
  private readonly cache: CacheRepository
  private readonly contacts: ContactRepository
  private readonly conversations: ConversationRepository
  private readonly messages: MessageRepository
  private readonly search: SearchRepository
  private closed = false

  constructor(filePath: string) {
    this.database = new DatabaseSync(filePath)
    initializeAccountSchema(this.database)
    this.cache = new CacheRepository(this.database)
    this.contacts = new ContactRepository(this.database)
    this.conversations = new ConversationRepository(this.database)
    this.messages = new MessageRepository(this.database)
    this.search = new SearchRepository(this.database)
  }

  upsertCurrentConversations(conversations: StoredConversation[]) {
    this.conversations.upsertCurrent(conversations)
  }

  hasCurrentConversation(conversationId: string) {
    return this.conversations.hasCurrent(conversationId)
  }

  touchConversationActivity(conversationId: string, createdAt: string) {
    this.conversations.touchActivity(conversationId, createdAt)
  }

  setConversationPinned(conversationId: string, pinned: boolean) {
    return this.conversations.setPinned(conversationId, pinned)
  }

  setConversationMuted(conversationId: string, muted: boolean) {
    return this.conversations.setMuted(conversationId, muted)
  }

  removeCurrentConversation(conversationId: string) {
    this.conversations.removeCurrent(conversationId)
  }

  listConversations(): DesktopConversation[] {
    return this.conversations.list()
  }

  upsertMessages(...args: Parameters<MessageRepository["upsertMessages"]>) {
    return this.messages.upsertMessages(...args)
  }

  createOptimisticMessage(...args: Parameters<MessageRepository["createOptimisticMessage"]>) {
    return this.messages.createOptimisticMessage(...args)
  }

  createOptimisticFileMessage(
    ...args: Parameters<MessageRepository["createOptimisticFileMessage"]>
  ) {
    return this.messages.createOptimisticFileMessage(...args)
  }

  createOptimisticImageMessage(
    ...args: Parameters<MessageRepository["createOptimisticImageMessage"]>
  ) {
    return this.messages.createOptimisticImageMessage(...args)
  }

  createOptimisticVideoMessage(
    ...args: Parameters<MessageRepository["createOptimisticVideoMessage"]>
  ) {
    return this.messages.createOptimisticVideoMessage(...args)
  }

  setOutgoingMessageStatus(...args: Parameters<MessageRepository["setOutgoingMessageStatus"]>) {
    return this.messages.setOutgoingMessageStatus(...args)
  }

  getOutgoingMessage(...args: Parameters<MessageRepository["getOutgoingMessage"]>) {
    return this.messages.getOutgoingMessage(...args)
  }

  getOutgoingMedia(...args: Parameters<MessageRepository["getOutgoingMedia"]>) {
    return this.messages.getOutgoingMedia(...args)
  }

  failPendingMessages(...args: Parameters<MessageRepository["failPendingMessages"]>) {
    return this.messages.failPendingMessages(...args)
  }

  updateMessageReactions(...args: Parameters<MessageRepository["updateMessageReactions"]>) {
    return this.messages.updateMessageReactions(...args)
  }

  listMessages(...args: Parameters<MessageRepository["listMessages"]>) {
    return this.messages.listMessages(...args)
  }

  updateMessageChoice(...args: Parameters<MessageRepository["updateMessageChoice"]>) {
    return this.messages.updateMessageChoice(...args)
  }

  updateMessageTopicRecentReplies(
    ...args: Parameters<MessageRepository["updateMessageTopicRecentReplies"]>
  ) {
    return this.messages.updateMessageTopicRecentReplies(...args)
  }

  searchContacts(...args: Parameters<SearchRepository["searchContacts"]>) {
    return this.search.searchContacts(...args)
  }

  searchApps(...args: Parameters<SearchRepository["searchApps"]>) {
    return this.search.searchApps(...args)
  }

  searchGroups(...args: Parameters<SearchRepository["searchGroups"]>) {
    return this.search.searchGroups(...args)
  }

  searchMessages(...args: Parameters<SearchRepository["searchMessages"]>) {
    return this.search.searchMessages(...args)
  }

  replaceContacts(input: {
    mode: "organization" | "friends"
    users: StoredContactUser[]
    groups: StoredContactGroup[]
    apps: StoredContactApp[]
  }) {
    this.contacts.replace(input)
  }

  setContactUserPresence(userId: string, online: boolean) {
    return this.contacts.setUserPresence(userId, online)
  }

  getContacts(): DesktopContactDirectory {
    return this.contacts.getDirectory()
  }

  getConversationPayload(conversationId: string): unknown {
    return this.conversations.getPayload(conversationId)
  }

  getContactPayload(type: "user" | "group" | "app", entityId: string): unknown {
    return this.contacts.getPayload(type, entityId)
  }

  getAvatarCache(type: string, entityId: string): AvatarCacheRecord | undefined {
    return this.cache.getAvatar(type, entityId)
  }

  getAvatarCacheByResourceKey(resourceKey: string): AvatarCacheRecord | undefined {
    return this.cache.getAvatarByResourceKey(resourceKey)
  }

  upsertAvatarCache(record: AvatarCacheRecord) {
    this.cache.upsertAvatar(record)
  }

  touchAvatarCache(type: string, entityId: string, checkedAt: number) {
    this.cache.touchAvatar(type, entityId, checkedAt)
  }

  deleteAvatarCache(type: string, entityId: string): AvatarCacheRecord | undefined {
    return this.cache.deleteAvatar(type, entityId)
  }

  deleteAvatarCaches(types: string[], entityId: string): AvatarCacheRecord[] {
    return this.cache.deleteAvatars(types, entityId)
  }

  getMediaCache(cacheKey: string): StoredMediaCache | undefined {
    return this.cache.getMedia(cacheKey)
  }

  listMediaCachesByFile(...args: Parameters<CacheRepository["listMediaByFile"]>) {
    return this.cache.listMediaByFile(...args)
  }

  listIncompleteMediaCaches(): StoredMediaCache[] {
    return this.cache.listIncompleteMedia()
  }

  upsertMediaCache(record: StoredMediaCache) {
    this.cache.upsertMedia(record)
  }

  touchMediaCache(cacheKey: string, lastAccessedAt: number) {
    this.cache.touchMedia(cacheKey, lastAccessedAt)
  }

  deleteMediaCache(cacheKey: string) {
    this.cache.deleteMedia(cacheKey)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }
}
