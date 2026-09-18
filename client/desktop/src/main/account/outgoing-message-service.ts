import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import type { DesktopMessage } from "../../shared/account-data"
import { AuthFailure, isRecord } from "../../shared/auth"
import { createLocalFileResponse } from "../local-file-response"
import { AccountDatabase } from "./account-database"
import { AuthenticatedClient } from "./authenticated-client"
import { parseMessage } from "./conversation-parser"

export class OutgoingMessageService {
  private readonly sending = new Set<string>()
  private closed = false

  constructor(
    private readonly database: AccountDatabase,
    private readonly client: AuthenticatedClient,
    private readonly currentUserId: string,
    private readonly currentUserName: string,
    private readonly onMessagesChanged: (conversationId: string) => void,
  ) {}

  sendTextMessage(
    conversationId: string,
    content: string,
    bodyType: "text" | "markdown",
  ): DesktopMessage[] {
    this.assertConversationId(conversationId)
    const normalized = content.trim()
    if (!normalized || normalized.length > 100_000) {
      throw new AuthFailure("invalid_message_content", "消息内容不正确")
    }
    if (bodyType !== "text" && bodyType !== "markdown") {
      throw new AuthFailure("invalid_message_type", "消息类型不正确")
    }
    const clientMessageId = randomUUID()
    this.database.createOptimisticMessage({
      conversationId,
      clientMessageId,
      content: normalized,
      bodyType,
      senderId: this.currentUserId,
      senderName: this.currentUserName,
    })
    this.onMessagesChanged(conversationId)
    this.deliverMessage(conversationId, clientMessageId, normalized, bodyType)
    return this.database.listMessages(conversationId, this.currentUserId)
  }

  sendFileMessage(
    conversationId: string,
    file: { path: string; name: string; sizeBytes: number },
  ): DesktopMessage[] {
    this.assertConversationId(conversationId)
    if (
      !file.path ||
      !file.name ||
      file.name.length > 255 ||
      !Number.isSafeInteger(file.sizeBytes) ||
      file.sizeBytes <= 0 ||
      file.sizeBytes > 500 * 1024 * 1024
    ) {
      throw new AuthFailure("invalid_file", "文件不符合发送要求")
    }
    const clientMessageId = randomUUID()
    this.database.createOptimisticFileMessage({
      conversationId,
      clientMessageId,
      filePath: file.path,
      name: file.name,
      sizeBytes: file.sizeBytes,
      senderId: this.currentUserId,
      senderName: this.currentUserName,
    })
    this.onMessagesChanged(conversationId)
    this.deliverFileMessage(conversationId, clientMessageId, file)
    return this.database.listMessages(conversationId, this.currentUserId)
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
  ): DesktopMessage[] {
    this.assertConversationId(conversationId)
    const caption = this.normalizeCaption(image.caption)
    if (
      !image.path ||
      !image.name ||
      image.name.length > 255 ||
      /[\\/]/.test(image.name) ||
      image.sizeBytes <= 0 ||
      image.sizeBytes > 2 * 1024 * 1024 ||
      !["image/webp", "image/png"].includes(image.contentType) ||
      !Number.isSafeInteger(image.width) ||
      !Number.isSafeInteger(image.height) ||
      image.width <= 0 ||
      image.height <= 0 ||
      image.width > 1920 ||
      image.height > 1920
    ) {
      throw new AuthFailure("invalid_image", "图片不符合发送要求")
    }
    const clientMessageId = randomUUID()
    this.database.createOptimisticImageMessage({
      conversationId,
      clientMessageId,
      ...image,
      filePath: image.path,
      caption,
      senderId: this.currentUserId,
      senderName: this.currentUserName,
    })
    this.onMessagesChanged(conversationId)
    this.deliverMediaMessage("image", conversationId, clientMessageId, image, caption, true)
    return this.database.listMessages(conversationId, this.currentUserId)
  }

  sendVideoMessage(
    conversationId: string,
    video: {
      path: string
      name: string
      sizeBytes: number
      contentType: "video/mp4" | "video/webm"
      caption: string
    },
  ): DesktopMessage[] {
    this.assertConversationId(conversationId)
    const caption = this.normalizeCaption(video.caption)
    if (
      !video.path ||
      !video.name ||
      video.name.length > 255 ||
      /[\\/]/.test(video.name) ||
      video.sizeBytes <= 0 ||
      video.sizeBytes > 100 * 1024 * 1024 ||
      !["video/mp4", "video/webm"].includes(video.contentType)
    ) {
      throw new AuthFailure("invalid_video", "视频不符合发送要求")
    }
    const clientMessageId = randomUUID()
    this.database.createOptimisticVideoMessage({
      conversationId,
      clientMessageId,
      ...video,
      filePath: video.path,
      caption,
      senderId: this.currentUserId,
      senderName: this.currentUserName,
    })
    this.onMessagesChanged(conversationId)
    this.deliverMediaMessage("video", conversationId, clientMessageId, video, caption, false)
    return this.database.listMessages(conversationId, this.currentUserId)
  }

  readOutgoingMedia(clientMessageId: string, range?: string) {
    const media = this.database.getOutgoingMedia(clientMessageId)
    if (!media) throw new AuthFailure("media_not_found", "待发送媒体不存在")
    return createLocalFileResponse(media.filePath, media.sizeBytes, media.contentType, range)
  }

  getOutgoingMedia(clientMessageId: string) {
    const media = this.database.getOutgoingMedia(clientMessageId)
    if (!media) throw new AuthFailure("media_not_found", "待发送媒体不存在")
    return media
  }

  retryMessage(conversationId: string, clientMessageId: string): DesktopMessage[] {
    this.assertConversationId(conversationId)
    if (!clientMessageId || clientMessageId.length > 128) {
      throw new AuthFailure("invalid_client_message", "待发送消息不存在")
    }
    const message = this.database.getOutgoingMessage(conversationId, clientMessageId)
    if (!message) throw new AuthFailure("message_not_found", "待发送消息不存在")
    if (!this.database.setOutgoingMessageStatus(conversationId, clientMessageId, "sending")) {
      throw new AuthFailure("message_not_found", "待发送消息不存在")
    }
    this.onMessagesChanged(conversationId)
    if (message.bodyType === "file") {
      this.deliverFileMessage(conversationId, clientMessageId, {
        path: message.filePath,
        name: message.name,
        sizeBytes: message.sizeBytes,
      })
    } else if (message.bodyType === "image" || message.bodyType === "video") {
      this.deliverMediaMessage(
        message.bodyType,
        conversationId,
        clientMessageId,
        {
          path: message.filePath,
          name: message.name,
          sizeBytes: message.sizeBytes,
          contentType: message.contentType,
        },
        message.caption,
        message.bodyType === "image",
      )
    } else if (
      (message.bodyType === "text" || message.bodyType === "markdown") &&
      typeof message.content === "string"
    ) {
      this.deliverMessage(conversationId, clientMessageId, message.content, message.bodyType)
    } else {
      throw new AuthFailure("message_not_found", "待发送消息不存在")
    }
    return this.database.listMessages(conversationId, this.currentUserId)
  }

  close() {
    this.closed = true
    this.sending.clear()
  }

  private deliverMessage(
    conversationId: string,
    clientMessageId: string,
    content: string,
    bodyType: "text" | "markdown",
  ) {
    if (this.closed || this.sending.has(clientMessageId)) return
    this.sending.add(clientMessageId)
    void this.client
      .post(`/api/client/conversations/${encodeURIComponent(conversationId)}/messages`, {
        client_message_id: clientMessageId,
        body: { type: bodyType, content },
      })
      .then((data) => {
        if (this.closed || !isRecord(data) || !isRecord(data.message)) {
          if (!this.closed) throw new AuthFailure("invalid_response", "发送消息响应格式不正确")
          return
        }
        this.database.upsertMessages([parseMessage(data.message, conversationId)])
        this.onMessagesChanged(conversationId)
      })
      .catch(() => {
        this.sending.delete(clientMessageId)
        if (this.closed) return
        if (this.database.setOutgoingMessageStatus(conversationId, clientMessageId, "failed")) {
          this.onMessagesChanged(conversationId)
        }
      })
      .finally(() => {
        this.sending.delete(clientMessageId)
      })
  }

  private deliverMediaMessage(
    category: "image" | "video",
    conversationId: string,
    clientMessageId: string,
    file: { path: string; name: string; sizeBytes: number; contentType: string },
    caption: string,
    temporary: boolean,
  ) {
    if (this.closed || this.sending.has(clientMessageId)) return
    this.sending.add(clientMessageId)
    const fields: Record<string, string> = { client_message_id: clientMessageId }
    if (caption) {
      fields.caption = caption
      fields.caption_type = "text"
    }
    void this.client
      .postFile(
        `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/${category === "image" ? "images" : "videos"}`,
        fields,
        { ...file, fieldName: category, contentType: file.contentType },
      )
      .then((data) => {
        if (this.closed || !isRecord(data) || !isRecord(data.message)) {
          if (!this.closed)
            throw new AuthFailure(
              "invalid_response",
              `发送${category === "image" ? "图片" : "视频"}响应格式不正确`,
            )
          return
        }
        this.database.upsertMessages([parseMessage(data.message, conversationId)])
        this.onMessagesChanged(conversationId)
        if (temporary) {
          const cleanup = setTimeout(() => void rm(file.path, { force: true }), 60_000)
          cleanup.unref()
        }
      })
      .catch(() => {
        this.sending.delete(clientMessageId)
        if (this.closed) return
        if (this.database.setOutgoingMessageStatus(conversationId, clientMessageId, "failed")) {
          this.onMessagesChanged(conversationId)
        }
      })
      .finally(() => {
        this.sending.delete(clientMessageId)
      })
  }

  private normalizeCaption(value: string) {
    const caption = value.trim()
    if (caption.length > 5_000) {
      throw new AuthFailure("invalid_caption", "媒体说明不能超过 5000 个字符")
    }
    return caption
  }

  private deliverFileMessage(
    conversationId: string,
    clientMessageId: string,
    file: { path: string; name: string; sizeBytes: number },
  ) {
    if (this.closed || this.sending.has(clientMessageId)) return
    this.sending.add(clientMessageId)
    void this.client
      .postFile(
        `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/files`,
        { client_message_id: clientMessageId },
        file,
      )
      .then((data) => {
        if (this.closed || !isRecord(data) || !isRecord(data.message)) {
          if (!this.closed) throw new AuthFailure("invalid_response", "发送文件响应格式不正确")
          return
        }
        this.database.upsertMessages([parseMessage(data.message, conversationId)])
        this.onMessagesChanged(conversationId)
      })
      .catch(() => {
        this.sending.delete(clientMessageId)
        if (this.closed) return
        if (this.database.setOutgoingMessageStatus(conversationId, clientMessageId, "failed")) {
          this.onMessagesChanged(conversationId)
        }
      })
      .finally(() => {
        this.sending.delete(clientMessageId)
      })
  }

  private assertConversationId(conversationId: string) {
    if (!conversationId || conversationId.length > 128) {
      throw new AuthFailure("invalid_conversation", "会话不存在")
    }
  }
}
