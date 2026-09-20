import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { dialog, type BrowserWindow } from "electron"
import type {
  ImportedMessageFile,
  SelectedMessageFile,
  SelectedMessageMedia,
  SendImageMessageInput,
} from "../../shared/account-data"
import { AuthFailure, isRecord } from "../../shared/auth"
import { createLocalFileResponse } from "../local-file-response"
import { detectImageContentType, isSelectionExpired, mediaContentType } from "./selection-policy"

type SelectedLocalMessageFile = SelectedMessageFile & {
  targetId: string
  path: string
  selectedAt: number
  category?: "image" | "video"
  contentType?: string
  staged?: boolean
}

function imageExtension(contentType: string) {
  if (contentType === "image/png") return ".png"
  if (contentType === "image/jpeg") return ".jpg"
  if (contentType === "image/webp") return ".webp"
  return ""
}

function videoExtension(contentType: string) {
  if (contentType === "video/mp4") return ".mp4"
  if (contentType === "video/webm") return ".webm"
  return ""
}

async function readFileHeader(filePath: string) {
  const handle = await open(filePath, "r")
  try {
    const header = Buffer.alloc(12)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    return header.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

export class SelectedMessageFileStore {
  private readonly files = new Map<string, SelectedLocalMessageFile>()

  constructor(private readonly userDataPath: string) {}

  async selectFile(targetId: string, parent: BrowserWindow): Promise<SelectedMessageFile | null> {
    if (!targetId) throw new AuthFailure("invalid_target", "账号不存在")
    this.deleteExpired()
    const selection = await dialog.showOpenDialog(parent, {
      title: "选择要发送的文件",
      properties: ["openFile"],
    })
    const filePath = selection.canceled ? undefined : selection.filePaths[0]
    if (!filePath) return null
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size <= 0) {
      throw new AuthFailure("invalid_file", "文件不能为空")
    }
    if (fileStat.size > 500 * 1024 * 1024) {
      throw new AuthFailure("file_too_large", "文件不能超过 500MiB")
    }
    const file = this.remember({
      targetId,
      path: filePath,
      name: path.basename(filePath),
      sizeBytes: fileStat.size,
    })
    return { token: file.token, name: file.name, sizeBytes: file.sizeBytes }
  }

  async importFile(input: unknown): Promise<ImportedMessageFile> {
    if (!isRecord(input) || typeof input.targetId !== "string" || !input.targetId) {
      throw new AuthFailure("invalid_target", "账号不存在")
    }
    const targetId = input.targetId
    const filePath = typeof input.path === "string" ? input.path : ""
    const bytes = input.bytes instanceof ArrayBuffer ? new Uint8Array(input.bytes) : undefined
    if (filePath && bytes) throw new AuthFailure("invalid_file", "文件来源不正确")
    const declaredSize = input.sizeBytes
    let sizeBytes: number
    if (filePath) {
      if (!path.isAbsolute(filePath)) throw new AuthFailure("invalid_file", "文件路径不正确")
      const fileStat = await stat(filePath)
      if (!fileStat.isFile() || fileStat.size !== declaredSize) {
        throw new AuthFailure("invalid_file", "所选文件已发生变化，请重新选择")
      }
      sizeBytes = fileStat.size
    } else {
      if (!bytes || bytes.byteLength > 20 * 1024 * 1024 || bytes.byteLength !== declaredSize) {
        throw new AuthFailure("invalid_file", "剪贴板文件过大或无法读取，请从文件管理器拖入")
      }
      sizeBytes = bytes.byteLength
    }
    if (sizeBytes <= 0 || sizeBytes > 500 * 1024 * 1024) {
      throw new AuthFailure("invalid_file", "文件不能为空且不能超过 500MiB")
    }
    const contentType = typeof input.contentType === "string" ? input.contentType : ""
    const rawName = typeof input.name === "string" && input.name ? input.name : filePath
    const name = path.basename(rawName.replaceAll("\\", "/")).slice(0, 255)
    const extension = path.extname(name).toLowerCase()
    const imageType = mediaContentType("image", extension || imageExtension(contentType))
    const videoType = mediaContentType("video", extension || videoExtension(contentType))
    let category: "image" | "video" | undefined
    let mediaType = ""
    if (imageType) {
      const header = bytes ?? (await readFileHeader(filePath))
      if (detectImageContentType(header) !== imageType) {
        throw new AuthFailure("invalid_media_type", "图片内容格式不正确")
      }
      category = "image"
      mediaType = imageType
    } else if (videoType) {
      if (sizeBytes > 100 * 1024 * 1024) {
        throw new AuthFailure("video_too_large", "视频大于 100MiB，无法上传")
      }
      category = "video"
      mediaType = videoType
    }
    this.deleteExpired()
    let storedPath = filePath
    if (bytes) {
      const directory = path.join(this.userDataPath, "pending-uploads")
      await mkdir(directory, { recursive: true })
      storedPath = path.join(
        directory,
        `${randomUUID()}${extension || imageExtension(mediaType) || ".bin"}`,
      )
      try {
        await writeFile(storedPath, bytes, { flag: "wx" })
      } catch (error) {
        await rm(storedPath, { force: true })
        throw error
      }
    }
    try {
      const file = this.remember({
        targetId,
        path: storedPath,
        name:
          name ||
          (category === "image"
            ? `image${imageExtension(mediaType)}`
            : category === "video"
              ? `video${videoExtension(mediaType)}`
              : "file"),
        sizeBytes,
        ...(category ? { category, contentType: mediaType } : {}),
        staged: Boolean(bytes),
      })
      return category
        ? {
            token: file.token,
            name: file.name,
            sizeBytes,
            category,
            contentType: mediaType,
            resourceUrl: `jiying-media://selection/${encodeURIComponent(targetId)}/${encodeURIComponent(file.token)}`,
          }
        : { token: file.token, name: file.name, sizeBytes }
    } catch (error) {
      if (bytes) await rm(storedPath, { force: true })
      throw error
    }
  }

  consume(token: string, targetId: string) {
    this.requireSelection(token, targetId, "invalid_file_selection")
    this.files.delete(token)
  }

  async release(token: string, targetId: string) {
    const file = this.requireSelection(token, targetId, "invalid_file_selection")
    this.files.delete(token)
    if (file.staged) await rm(file.path, { force: true })
  }

  async selectAppAvatar(targetId: string, parent: BrowserWindow) {
    const media = await this.selectMedia({ targetId, category: "image" }, parent)
    if (!media) return null
    const file = this.getMedia(media.token, targetId, "image", "invalid_image_selection")
    if (file.sizeBytes > 5 * 1024 * 1024) {
      this.delete(media.token)
      throw new AuthFailure("image_too_large", "应用头像不能超过 5MiB")
    }
    const detected = detectImageContentType(await readFile(file.path))
    if (!detected || detected !== file.contentType) {
      this.delete(media.token)
      throw new AuthFailure("invalid_image", "应用头像内容格式不正确")
    }
    return {
      token: media.token,
      name: media.name,
      sizeBytes: media.sizeBytes,
      contentType: media.contentType as "image/jpeg" | "image/png" | "image/webp",
      resourceUrl: media.resourceUrl,
    }
  }

  async selectMedia(
    input: { targetId?: string; category?: "image" | "video" } | undefined,
    parent: BrowserWindow,
  ): Promise<SelectedMessageMedia | null> {
    const targetId = input?.targetId ?? ""
    const category = input?.category
    if (!targetId || (category !== "image" && category !== "video")) {
      throw new AuthFailure("invalid_media_selection", "媒体选择请求不正确")
    }
    this.deleteExpired()
    const selection = await dialog.showOpenDialog(parent, {
      title: category === "image" ? "选择要发送的图片" : "选择要发送的视频",
      properties: ["openFile"],
      filters:
        category === "image"
          ? [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }]
          : [{ name: "视频", extensions: ["mp4", "webm"] }],
    })
    const filePath = selection.canceled ? undefined : selection.filePaths[0]
    if (!filePath) return null
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size <= 0) {
      throw new AuthFailure("invalid_media", category === "image" ? "图片不能为空" : "视频不能为空")
    }
    if (category === "video" && fileStat.size > 100 * 1024 * 1024) {
      throw new AuthFailure("video_too_large", "视频大于 100MiB，无法上传")
    }
    const contentType = mediaContentType(category, path.extname(filePath).toLowerCase())
    if (!contentType) {
      throw new AuthFailure(
        "invalid_media_type",
        category === "image" ? "请选择 PNG、JPG 或 WebP 图片" : "视频必须是 MP4 或 WebM 格式",
      )
    }
    const file = this.remember({
      targetId,
      path: filePath,
      name: path.basename(filePath),
      sizeBytes: fileStat.size,
      category,
      contentType,
    })
    return {
      token: file.token,
      name: file.name,
      sizeBytes: file.sizeBytes,
      category,
      contentType,
      resourceUrl: `jiying-media://selection/${encodeURIComponent(targetId)}/${encodeURIComponent(file.token)}`,
    }
  }

  getFile(selectionToken: string, targetId: string) {
    const file = this.requireSelection(selectionToken, targetId, "invalid_file_selection")
    return file
  }

  getMedia(
    selectionToken: string,
    targetId: string,
    category: "image" | "video",
    errorCode: "invalid_image_selection" | "invalid_video_selection",
  ) {
    const file = this.requireSelection(selectionToken, targetId, errorCode)
    if (file.category !== category) {
      throw new AuthFailure(
        errorCode,
        category === "image" ? "所选图片已失效，请重新选择" : "所选视频已失效，请重新选择",
      )
    }
    return file
  }

  async assertUnchanged(file: SelectedLocalMessageFile, code: string, message: string) {
    const fileStat = await stat(file.path)
    if (!fileStat.isFile() || fileStat.size !== file.sizeBytes) {
      throw new AuthFailure(code, message)
    }
  }

  async stageImage(input: SendImageMessageInput) {
    if (!(input.bytes instanceof ArrayBuffer)) {
      throw new AuthFailure("invalid_image_selection", "所选图片已失效，请重新选择")
    }
    const bytes = new Uint8Array(input.bytes)
    if (bytes.byteLength <= 0 || bytes.byteLength > 2 * 1024 * 1024) {
      throw new AuthFailure("invalid_image", "图片大于 2MB，无法上传")
    }
    const contentType = detectImageContentType(bytes)
    if (!contentType || contentType !== input.contentType) {
      throw new AuthFailure("invalid_image", "图片内容格式不正确")
    }
    const uploadsDirectory = path.join(this.userDataPath, "pending-uploads")
    await mkdir(uploadsDirectory, { recursive: true })
    const stagedPath = path.join(
      uploadsDirectory,
      `${randomUUID()}${contentType === "image/webp" ? ".webp" : ".png"}`,
    )
    await writeFile(stagedPath, bytes, { flag: "wx" })
    return {
      path: stagedPath,
      sizeBytes: bytes.byteLength,
      remove: () => rm(stagedPath, { force: true }),
    }
  }

  createSelectionResponse(targetId: string, token: string, range?: string) {
    const file = this.files.get(token)
    if (!file || file.targetId !== targetId || !file.contentType || this.expired(file)) {
      return new Response(null, { status: 404 })
    }
    return createLocalFileResponse(file.path, file.sizeBytes, file.contentType, range)
  }

  delete(token: string) {
    this.files.delete(token)
  }

  private remember(input: Omit<SelectedLocalMessageFile, "token" | "selectedAt">) {
    const file: SelectedLocalMessageFile = {
      ...input,
      token: randomUUID(),
      selectedAt: Date.now(),
    }
    this.files.set(file.token, file)
    return file
  }

  private requireSelection(token: string, targetId: string, errorCode: string) {
    const file = token ? this.files.get(token) : undefined
    if (!file || file.targetId !== targetId || this.expired(file)) {
      const media = errorCode.includes("image")
        ? "图片"
        : errorCode.includes("video")
          ? "视频"
          : "文件"
      throw new AuthFailure(errorCode, `所选${media}已失效，请重新选择`)
    }
    return file
  }

  private deleteExpired() {
    for (const [token, file] of this.files) {
      if (this.expired(file)) {
        this.files.delete(token)
        if (file.staged) void rm(file.path, { force: true }).catch(() => undefined)
      }
    }
  }

  private expired(file: SelectedLocalMessageFile) {
    return isSelectionExpired(file.selectedAt)
  }
}
