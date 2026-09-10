import { randomUUID } from "node:crypto"
import { PassThrough, Readable } from "node:stream"
import {
  assertClientPath,
  type AuthenticatedTarget,
  type ClientRequest,
  type ClientResponse,
} from "@shared/client-contract"
import type { ServerProfiles } from "@main/server-profiles"
import type { SessionController } from "@main/session-controller"

const MAX_CHUNK_BYTES = 256 * 1024
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024
const MAX_FILE_MESSAGE_BYTES = 500 * 1024 * 1024
const MAX_FILE_MESSAGE_MULTIPART_BYTES = MAX_FILE_MESSAGE_BYTES + 1024 * 1024
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_MULTIPART_HEADER_BYTES = 64 * 1024

type Upload = {
  abort: AbortController
  bytes: number
  ownerId: number
  requestId: string
  response: Promise<Response>
  serverId: string
  stream: PassThrough
  fileSizeGuard?: MultipartFileSizeGuard
  maxBytes: number
}

export class StreamingUploadController {
  private readonly uploads = new Map<string, Upload>()

  constructor(
    private readonly profiles: ServerProfiles,
    private readonly sessions: SessionController,
  ) {}

  start(
    ownerId: number,
    target: AuthenticatedTarget,
    request: Pick<ClientRequest, "headers" | "method" | "path" | "requestId">,
  ): string {
    if (!(["PATCH", "POST", "PUT"] as const).includes(request.method as "PATCH" | "POST" | "PUT"))
      throw new Error("流式上传方法无效")
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(request.requestId)) throw new Error("请求标识无效")
    const profile = this.profiles.require(target.id)
    if (profile.normalizedUrl !== target.normalizedUrl) throw new Error("认证目标无效")
    const contentType = request.headers?.["content-type"] ?? request.headers?.["Content-Type"] ?? ""
    const boundary = parseMultipartBoundary(contentType)
    if (!boundary || /[\r\n]/.test(contentType)) throw new Error("流式上传 Content-Type 无效")
    const isFileMessage = new URL(request.path, "https://local.invalid").pathname.endsWith(
      "/messages/files",
    )
    const stream = new PassThrough({ highWaterMark: MAX_CHUNK_BYTES })
    const abort = new AbortController()
    const response = this.sessions
      .for(profile)
      .fetch(`${profile.normalizedUrl}${assertClientPath(request.path)}`, {
        body: Readable.toWeb(stream) as ReadableStream,
        credentials: "include",
        duplex: "half",
        headers: { Accept: "application/json", "Content-Type": contentType },
        method: request.method,
        signal: abort.signal,
      } as RequestInit)
    const id = randomUUID()
    this.uploads.set(id, {
      abort,
      bytes: 0,
      ownerId,
      requestId: request.requestId,
      response,
      serverId: profile.id,
      stream,
      fileSizeGuard: isFileMessage
        ? new MultipartFileSizeGuard(boundary, MAX_FILE_MESSAGE_BYTES)
        : undefined,
      maxBytes: isFileMessage ? MAX_FILE_MESSAGE_MULTIPART_BYTES : MAX_UPLOAD_BYTES,
    })
    return id
  }

  async chunk(ownerId: number, streamId: string, rawChunk: Uint8Array): Promise<void> {
    const upload = this.require(ownerId, streamId)
    const chunk = Uint8Array.from(rawChunk)
    if (chunk.byteLength === 0 || chunk.byteLength > MAX_CHUNK_BYTES)
      throw new Error("上传分块大小无效")
    upload.bytes += chunk.byteLength
    if (upload.bytes > upload.maxBytes) {
      this.abort(ownerId, streamId)
      throw new Error(
        upload.maxBytes === MAX_FILE_MESSAGE_MULTIPART_BYTES
          ? "上传文件超过 500 MiB 限制"
          : "上传文件超过 5 GiB 限制",
      )
    }
    try {
      upload.fileSizeGuard?.push(chunk)
    } catch (error) {
      this.abort(ownerId, streamId)
      throw error
    }
    if (!upload.stream.write(Buffer.from(chunk)))
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          upload.stream.off("drain", onDrain)
          upload.stream.off("error", onError)
        }
        const onDrain = () => {
          cleanup()
          resolve()
        }
        const onError = (error: Error) => {
          cleanup()
          reject(error)
        }
        upload.stream.once("drain", onDrain)
        upload.stream.once("error", onError)
      })
  }

  async finish(ownerId: number, streamId: string): Promise<ClientResponse> {
    const upload = this.require(ownerId, streamId)
    try {
      upload.fileSizeGuard?.finish()
    } catch (error) {
      this.abort(ownerId, streamId)
      throw error
    }
    upload.stream.end()
    try {
      const response = await upload.response
      const declared = Number(response.headers.get("content-length") ?? 0)
      if (declared > MAX_RESPONSE_BYTES) throw new Error("上传响应过大")
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("上传响应过大")
      const contentType = response.headers.get("content-type") ?? ""
      const text = new TextDecoder().decode(bytes)
      return {
        body: contentType.includes("application/json") ? JSON.parse(text || "null") : text,
        headers: { "content-type": contentType },
        status: response.status,
      }
    } finally {
      this.uploads.delete(streamId)
    }
  }

  abort(ownerId: number, streamId: string): void {
    const upload = this.require(ownerId, streamId)
    upload.abort.abort()
    upload.stream.destroy(new Error("上传已取消"))
    void upload.response.catch(() => undefined)
    this.uploads.delete(streamId)
  }

  releaseOwner(ownerId: number): void {
    for (const [id, upload] of this.uploads) if (upload.ownerId === ownerId) this.abort(ownerId, id)
  }

  cleanupServer(serverId: string): void {
    for (const [id, upload] of this.uploads)
      if (upload.serverId === serverId) this.abort(upload.ownerId, id)
  }

  hasActiveTransfers(): boolean {
    return this.uploads.size > 0
  }

  private require(ownerId: number, streamId: string): Upload {
    if (!/^[a-f0-9-]{36}$/.test(streamId)) throw new Error("上传流标识无效")
    const upload = this.uploads.get(streamId)
    if (!upload || upload.ownerId !== ownerId) throw new Error("上传流不存在或不属于当前窗口")
    return upload
  }
}

type MultipartGuardState = "body" | "boundary" | "done" | "headers" | "opening"

export class MultipartFileSizeGuard {
  private buffer = Buffer.alloc(0)
  private currentPartIsFile = false
  private fileBytes = 0
  private filePartSeen = false
  private readonly bodyBoundary: Buffer
  private readonly openingBoundary: Buffer
  private state: MultipartGuardState = "opening"

  constructor(
    boundary: string,
    private readonly maxFileBytes: number,
  ) {
    this.openingBoundary = Buffer.from(`--${boundary}\r\n`, "latin1")
    this.bodyBoundary = Buffer.from(`\r\n--${boundary}`, "latin1")
  }

  push(chunk: Uint8Array) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
    this.process(false)
  }

  finish() {
    this.process(true)
    if (this.state !== "done" || this.buffer.length > 0) {
      throw new Error("文件上传内容格式无效")
    }
    if (!this.filePartSeen || this.fileBytes === 0) {
      throw new Error("文件不能为空")
    }
  }

  private process(finishing: boolean) {
    for (;;) {
      if (this.state === "opening") {
        if (this.buffer.length < this.openingBoundary.length) {
          if (finishing) throw new Error("文件上传内容格式无效")
          return
        }
        if (!this.buffer.subarray(0, this.openingBoundary.length).equals(this.openingBoundary)) {
          throw new Error("文件上传内容格式无效")
        }
        this.consume(this.openingBoundary.length)
        this.state = "headers"
        continue
      }

      if (this.state === "headers") {
        const headerEnd = this.buffer.indexOf("\r\n\r\n", 0, "latin1")
        if (headerEnd < 0) {
          if (this.buffer.length > MAX_MULTIPART_HEADER_BYTES || finishing) {
            throw new Error("文件上传内容格式无效")
          }
          return
        }
        const headers = this.buffer.subarray(0, headerEnd).toString("latin1")
        const disposition = /^content-disposition:\s*form-data;([^\r\n]*)$/im.exec(headers)?.[1]
        const fieldName = disposition
          ? /(?:^|;)\s*name="([^"]*)"/i.exec(disposition)?.[1]
          : undefined
        this.currentPartIsFile = fieldName === "file"
        if (this.currentPartIsFile) {
          if (this.filePartSeen) throw new Error("文件上传内容格式无效")
          this.filePartSeen = true
        }
        this.consume(headerEnd + 4)
        this.state = "body"
        continue
      }

      if (this.state === "body") {
        const boundaryIndex = this.buffer.indexOf(this.bodyBoundary)
        if (boundaryIndex >= 0) {
          const suffixOffset = boundaryIndex + this.bodyBoundary.length
          if (this.buffer.length < suffixOffset + 2) {
            this.countFileBytes(boundaryIndex)
            this.consume(boundaryIndex)
            if (finishing) throw new Error("文件上传内容格式无效")
            return
          }
          const suffix = this.buffer.subarray(suffixOffset, suffixOffset + 2).toString("latin1")
          if (suffix !== "\r\n" && suffix !== "--") {
            const bodyBytes = boundaryIndex + this.bodyBoundary.length
            this.countFileBytes(bodyBytes)
            this.consume(bodyBytes)
            continue
          }
          this.countFileBytes(boundaryIndex)
          this.consume(boundaryIndex + this.bodyBoundary.length)
          this.state = "boundary"
          continue
        }

        const retainedBytes = Math.min(this.buffer.length, this.bodyBoundary.length - 1)
        const consumedBytes = this.buffer.length - retainedBytes
        if (consumedBytes === 0) {
          if (finishing) throw new Error("文件上传内容格式无效")
          return
        }
        this.countFileBytes(consumedBytes)
        this.consume(consumedBytes)
        if (finishing) continue
        return
      }

      if (this.state === "done") {
        if (this.buffer.length === 0) return
        if (this.buffer.length === 1 && this.buffer[0] === 13 && !finishing) return
        if (this.buffer.subarray(0, 2).toString("latin1") === "\r\n") {
          this.consume(2)
        }
        if (this.buffer.length > 0) throw new Error("文件上传内容格式无效")
        return
      }

      if (this.buffer.length < 2) {
        if (finishing) throw new Error("文件上传内容格式无效")
        return
      }
      const suffix = this.buffer.subarray(0, 2).toString("latin1")
      if (suffix === "\r\n") {
        this.consume(2)
        this.state = "headers"
        continue
      }
      if (suffix !== "--") throw new Error("文件上传内容格式无效")
      this.consume(2)
      this.state = "done"
    }
  }

  private countFileBytes(count: number) {
    if (!this.currentPartIsFile) return
    this.fileBytes += count
    if (this.fileBytes > this.maxFileBytes) {
      throw new Error("上传文件超过 500 MiB 限制")
    }
  }

  private consume(count: number) {
    this.buffer = this.buffer.subarray(count)
  }
}

function parseMultipartBoundary(contentType: string) {
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return null
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)
  const boundary = (match?.[1] ?? match?.[2] ?? "").trim()
  if (!boundary || boundary.length > 200 || /[\u0000-\u0020\u007f]/.test(boundary)) return null
  return boundary
}
