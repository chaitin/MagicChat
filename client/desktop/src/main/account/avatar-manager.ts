import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import type { AvatarRequest, AvatarResult, AvatarType } from "../../shared/account-data"
import { AuthFailure } from "../../shared/auth"
import { AccountDatabase } from "./account-database"
import { AuthenticatedClient } from "./authenticated-client"
import { ContactManager } from "./contact-manager"
import { ConversationManager } from "./conversation-manager"
import { ProjectManager } from "./project-manager"
import type {
  AvatarCacheRecord,
  AvatarDescriptor,
  AvatarMemberDescriptor,
  AvatarResource,
} from "./avatar-types"

const AVATAR_MAX_AGE_MS = 24 * 60 * 60 * 1_000
const COMPOSITE_SIZE = 256
const COMPOSITE_STYLE_VERSION = 2
const ROLE_ORDER = { owner: 0, admin: 1, member: 2 } as const

export class AvatarManager {
  private readonly avatarDirectory: string
  private readonly inFlight = new Map<string, Promise<AvatarResult>>()
  private readonly resourceInFlight = new Map<string, Promise<AvatarCacheRecord | undefined>>()

  constructor(
    accountDirectory: string,
    private readonly serverUrl: string,
    private readonly database: AccountDatabase,
    private readonly client: AuthenticatedClient,
    private readonly conversations: ConversationManager,
    private readonly contacts: ContactManager,
    private readonly projects: ProjectManager,
    private readonly currentUser: AvatarDescriptor,
  ) {
    this.avatarDirectory = path.join(accountDirectory, "avatars")
  }

  getAvatar(request: Omit<AvatarRequest, "targetId">): Promise<AvatarResult> {
    validateReference(request.type, request.id)
    const key = `${request.type}:${request.id}:${request.theme}`
    const existing = this.inFlight.get(key)
    if (existing) return existing
    const operation = this.resolveAvatar(request).finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, operation)
    return operation
  }

  async invalidate(type: AvatarType, entityId: string) {
    validateReference(type, entityId)
    const descriptor = type === "project" ? undefined : await this.resolveDescriptor(type, entityId)
    const resolvedType = descriptor?.type ?? fallbackTypeFor(type)
    const resolvedId = descriptor?.id ?? entityId
    const cacheTypes =
      resolvedType === "group"
        ? [
            "group",
            "group-composite-light",
            "group-composite-dark",
            `group-composite-v${COMPOSITE_STYLE_VERSION}-light`,
            `group-composite-v${COMPOSITE_STYLE_VERSION}-dark`,
          ]
        : [resolvedType]
    const records = this.database.deleteAvatarCaches(cacheTypes, resolvedId)
    await Promise.all(records.map((record) => removeFile(this.localPath(record.localFile))))
  }

  async readResource(resourceKey: string): Promise<AvatarResource> {
    if (!/^[a-f0-9]{64}$/.test(resourceKey)) {
      throw new AuthFailure("invalid_avatar", "头像资源不存在")
    }
    const record = this.database.getAvatarCacheByResourceKey(resourceKey)
    if (!record) throw new AuthFailure("avatar_not_found", "头像资源不存在")
    return {
      contentType: record.contentType,
      bytes: await readFile(this.localPath(record.localFile)),
    }
  }

  private async resolveAvatar(request: Omit<AvatarRequest, "targetId">): Promise<AvatarResult> {
    const projectCache =
      request.type === "project" ? this.database.getAvatarCache("project", request.id) : undefined
    const projectCacheAvailable = projectCache
      ? await fileExists(this.localPath(projectCache.localFile))
      : false
    if (
      projectCache &&
      projectCacheAvailable &&
      Date.now() - projectCache.checkedAt < AVATAR_MAX_AGE_MS
    ) {
      return { status: "ready", type: "project", resourceUrl: resourceUrl(projectCache) }
    }

    let descriptor: AvatarDescriptor | undefined
    try {
      descriptor = await this.resolveDescriptor(request.type, request.id)
    } catch {
      return projectCache && projectCacheAvailable
        ? { status: "ready", type: "project", resourceUrl: resourceUrl(projectCache) }
        : { status: "fallback", type: fallbackTypeFor(request.type) }
    }
    const fallbackType = descriptor?.type ?? fallbackTypeFor(request.type)
    if (!descriptor) return { status: "fallback", type: fallbackType }
    if (descriptor.type === "group" && !descriptor.avatarUrl) {
      return this.resolveGroupComposite(descriptor, request.theme)
    }
    const record = await this.ensureOrdinaryAvatar(descriptor)
    if (record) return { status: "ready", type: descriptor.type, resourceUrl: resourceUrl(record) }
    if (descriptor.type === "group") {
      const refreshed = this.contacts.getAvatarDescriptor("group", descriptor.id)
      if (refreshed && !refreshed.avatarUrl) {
        return this.resolveGroupComposite(refreshed, request.theme)
      }
    }
    return { status: "fallback", type: descriptor.type }
  }

  private async resolveDescriptor(
    type: AvatarType,
    entityId: string,
  ): Promise<AvatarDescriptor | undefined> {
    if (type === "group") {
      return (
        this.contacts.getAvatarDescriptor("group", entityId) ??
        this.conversations.getAvatarDescriptor("group", entityId)
      )
    }
    if (type === "topic") {
      return this.conversations.getAvatarDescriptor("topic", entityId)
    }
    if (type === "user" || type === "app") {
      if (type === "user" && entityId === this.currentUser.id) return this.currentUser
      return this.contacts.getAvatarDescriptor(type, entityId)
    }
    return this.projects.getAvatarDescriptor(entityId)
  }

  private ensureOrdinaryAvatar(
    descriptor: AvatarDescriptor | AvatarMemberDescriptor,
  ): Promise<AvatarCacheRecord | undefined> {
    const key = `${descriptor.type}:${descriptor.id}`
    const existing = this.resourceInFlight.get(key)
    if (existing) return existing
    const operation = this.loadOrdinaryAvatar(descriptor).finally(() =>
      this.resourceInFlight.delete(key),
    )
    this.resourceInFlight.set(key, operation)
    return operation
  }

  private async loadOrdinaryAvatar(
    descriptor: AvatarDescriptor | AvatarMemberDescriptor,
  ): Promise<AvatarCacheRecord | undefined> {
    const cached = this.database.getAvatarCache(descriptor.type, descriptor.id)
    const cachedAvailable = cached ? await fileExists(this.localPath(cached.localFile)) : false
    const now = Date.now()

    if (cached && cachedAvailable && now - cached.checkedAt < AVATAR_MAX_AGE_MS) return cached
    let currentDescriptor = descriptor
    if (
      (descriptor.type === "user" || descriptor.type === "group" || descriptor.type === "app") &&
      (!descriptor.avatarUrl || (cached && cachedAvailable))
    ) {
      try {
        const refreshed = await this.contacts.refreshAvatarDescriptor(
          descriptor.type,
          descriptor.id,
        )
        if (!refreshed) return cached && cachedAvailable ? cached : undefined
        currentDescriptor = refreshed
      } catch {
        return cached && cachedAvailable ? cached : undefined
      }
    }
    const sourceUrl = normalizeSourceUrl(this.serverUrl, currentDescriptor.avatarUrl)
    if (cached && cachedAvailable && cached.sourceUrl === sourceUrl) {
      this.database.touchAvatarCache(cached.type, cached.entityId, now)
      return { ...cached, checkedAt: now }
    }
    if (!sourceUrl) {
      if (cached) await this.removeRecord(cached)
      return undefined
    }

    try {
      const downloaded = await this.client.downloadAvatar(sourceUrl)
      const extension = extensionFor(downloaded.contentType)
      const resourceKey = cacheResourceKey(descriptor.type, descriptor.id, sourceUrl)
      const localFile = `${resourceKey}.${extension}`
      await mkdir(this.avatarDirectory, { recursive: true })
      const temporary = this.localPath(`${randomUUID()}.tmp`)
      await writeFile(temporary, downloaded.bytes, { mode: 0o600 })
      await rename(temporary, this.localPath(localFile))
      const record: AvatarCacheRecord = {
        type: descriptor.type,
        entityId: descriptor.id,
        sourceUrl,
        localFile,
        contentType: downloaded.contentType,
        resourceKey,
        downloadedAt: now,
        checkedAt: now,
      }
      this.database.upsertAvatarCache(record)
      if (cached && cached.localFile !== localFile)
        await removeFile(this.localPath(cached.localFile))
      return record
    } catch {
      return cached && cachedAvailable ? cached : undefined
    }
  }

  private async resolveGroupComposite(
    descriptor: AvatarDescriptor,
    theme: "light" | "dark",
  ): Promise<AvatarResult> {
    const cacheType = `group-composite-v${COMPOSITE_STYLE_VERSION}-${theme}`
    const legacy = this.database.deleteAvatarCache(`group-composite-${theme}`, descriptor.id)
    if (legacy) await removeFile(this.localPath(legacy.localFile))
    const cached = this.database.getAvatarCache(cacheType, descriptor.id)
    const cachedAvailable = cached ? await fileExists(this.localPath(cached.localFile)) : false
    if (cached && cachedAvailable && Date.now() - cached.checkedAt < AVATAR_MAX_AGE_MS) {
      return { status: "ready", type: "group", resourceUrl: resourceUrl(cached) }
    }

    let currentDescriptor = descriptor
    let validatedAt: number | undefined
    if (cached && cachedAvailable) {
      try {
        const refreshed = await this.contacts.refreshAvatarDescriptor("group", descriptor.id)
        if (!refreshed) {
          return { status: "ready", type: "group", resourceUrl: resourceUrl(cached) }
        }
        currentDescriptor = refreshed
        validatedAt = Date.now()
        if (currentDescriptor.avatarUrl) {
          const direct = await this.ensureOrdinaryAvatar(currentDescriptor)
          return direct
            ? { status: "ready", type: "group", resourceUrl: resourceUrl(direct) }
            : { status: "fallback", type: "group" }
        }
      } catch {
        return { status: "ready", type: "group", resourceUrl: resourceUrl(cached) }
      }
    }

    const members = selectGroupMembers(currentDescriptor.members ?? [])
    if (members.length === 0) return { status: "fallback", type: "group" }
    const grid = members.length <= 4 ? 2 : 3
    const tiles = await Promise.all(
      members.map(async (member) => ({
        member,
        record: await this.ensureOrdinaryAvatar(member),
      })),
    )
    const signatureSource = JSON.stringify({
      version: COMPOSITE_STYLE_VERSION,
      groupId: descriptor.id,
      theme,
      grid,
      members: tiles.map(({ member, record }) => ({
        type: member.type,
        id: member.id,
        avatarUrl: record?.sourceUrl ?? "",
      })),
    })
    const signature = createHash("sha256").update(signatureSource).digest("hex")
    if (cached && cachedAvailable && cached.sourceUrl === `composite:${signature}`) {
      if (validatedAt) this.database.touchAvatarCache(cacheType, descriptor.id, validatedAt)
      return { status: "ready", type: "group", resourceUrl: resourceUrl(cached) }
    }
    const svg = await buildCompositeSvg(tiles, grid, theme, (file) =>
      readFile(this.localPath(file)),
    )
    await mkdir(this.avatarDirectory, { recursive: true })
    const resourceKey = cacheResourceKey(cacheType, descriptor.id, signature)
    const localFile = `${resourceKey}.svg`
    const temporary = this.localPath(`${randomUUID()}.tmp`)
    await writeFile(temporary, svg, { encoding: "utf8", mode: 0o600 })
    await rename(temporary, this.localPath(localFile))
    const now = Date.now()
    const record: AvatarCacheRecord = {
      type: cacheType,
      entityId: descriptor.id,
      sourceUrl: `composite:${signature}`,
      localFile,
      contentType: "image/svg+xml",
      resourceKey,
      downloadedAt: now,
      checkedAt: now,
    }
    this.database.upsertAvatarCache(record)
    if (cached && cached.localFile !== localFile) await removeFile(this.localPath(cached.localFile))
    return { status: "ready", type: "group", resourceUrl: resourceUrl(record) }
  }

  private async removeRecord(record: AvatarCacheRecord) {
    this.database.deleteAvatarCache(record.type, record.entityId)
    await removeFile(this.localPath(record.localFile))
  }

  private localPath(localFile: string): string {
    if (!/^[a-f0-9-]+\.(png|jpg|webp|gif|svg|tmp)$/.test(localFile)) {
      throw new AuthFailure("invalid_avatar", "头像缓存路径不正确")
    }
    return path.join(this.avatarDirectory, localFile)
  }
}

function validateReference(type: AvatarType, id: string) {
  if (!["user", "group", "topic", "app", "project"].includes(type)) {
    throw new AuthFailure("invalid_avatar", "头像类型不受支持")
  }
  if (!id || id.length > 128) throw new AuthFailure("invalid_avatar", "头像 ID 不正确")
}

function fallbackTypeFor(type: AvatarType): AvatarResult["type"] {
  return type === "topic" ? "group" : type
}

function normalizeSourceUrl(serverUrl: string, sourceUrl: string): string {
  if (!sourceUrl) return ""
  try {
    const url = new URL(sourceUrl, `${serverUrl}/`)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : ""
  } catch {
    return ""
  }
}

function selectGroupMembers(members: AvatarMemberDescriptor[]): AvatarMemberDescriptor[] {
  const limit = members.length <= 4 ? 4 : 9
  return members
    .map((member, index) => ({ member, index }))
    .sort(
      (left, right) =>
        ROLE_ORDER[left.member.role] - ROLE_ORDER[right.member.role] || left.index - right.index,
    )
    .slice(0, limit)
    .map(({ member }) => member)
}

async function buildCompositeSvg(
  tiles: Array<{ member: AvatarMemberDescriptor; record?: AvatarCacheRecord }>,
  grid: 2 | 3,
  theme: "light" | "dark",
  load: (file: string) => Promise<Uint8Array>,
): Promise<string> {
  const tileSize = COMPOSITE_SIZE / grid
  const rows = Math.ceil(tiles.length / grid)
  const verticalOffset = (COMPOSITE_SIZE - rows * tileSize) / 2
  const parts = await Promise.all(
    tiles.map(async ({ member, record }, index) => {
      const row = Math.floor(index / grid)
      const columnsInRow = Math.min(grid, tiles.length - row * grid)
      const column = index % grid
      const x = (COMPOSITE_SIZE - columnsInRow * tileSize) / 2 + column * tileSize
      const y = verticalOffset + row * tileSize
      if (record) {
        try {
          const bytes = await load(record.localFile)
          const source = `data:${record.contentType};base64,${Buffer.from(bytes).toString("base64")}`
          return `<image href="${source}" x="${x}" y="${y}" width="${tileSize}" height="${tileSize}" preserveAspectRatio="xMidYMid slice"/>`
        } catch {
          // 单个成员缓存损坏时使用该成员类型的 Fallback。
        }
      }
      return fallbackTile(member.type, x, y, tileSize, theme)
    }),
  )
  const background = theme === "dark" ? "#1e1e1e" : "#f7f7f7"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${COMPOSITE_SIZE}" height="${COMPOSITE_SIZE}" viewBox="0 0 ${COMPOSITE_SIZE} ${COMPOSITE_SIZE}"><rect width="100%" height="100%" fill="${background}"/>${parts.join("")}</svg>`
}

function fallbackTile(
  type: "user" | "app",
  x: number,
  y: number,
  size: number,
  theme: "light" | "dark",
): string {
  const color = type === "app" ? "#10aeff" : theme === "dark" ? "#1196ff" : "#1485ee"
  const centerX = x + size / 2
  const centerY = y + size / 2
  const radius = size * 0.16
  if (type === "app") {
    return `<g><rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${color}"/><rect x="${centerX - radius * 1.7}" y="${centerY - radius * 1.25}" width="${radius * 3.4}" height="${radius * 2.6}" rx="${radius * 0.6}" fill="none" stroke="#fff" stroke-width="${Math.max(2, size * 0.05)}"/><circle cx="${centerX - radius * 0.65}" cy="${centerY}" r="${radius * 0.2}" fill="#fff"/><circle cx="${centerX + radius * 0.65}" cy="${centerY}" r="${radius * 0.2}" fill="#fff"/><path d="M ${centerX} ${centerY - radius * 1.25}V ${centerY - radius * 2}" stroke="#fff" stroke-width="${Math.max(2, size * 0.05)}"/><circle cx="${centerX}" cy="${centerY - radius * 2.1}" r="${radius * 0.2}" fill="#fff"/></g>`
  }
  return `<g><rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${color}"/><circle cx="${centerX}" cy="${centerY - radius}" r="${radius}" fill="#fff"/><ellipse cx="${centerX}" cy="${centerY + radius * 1.4}" rx="${radius * 1.7}" ry="${radius * 1.3}" fill="#fff"/></g>`
}

function cacheResourceKey(type: string, entityId: string, source: string): string {
  return createHash("sha256")
    .update(type)
    .update("\0")
    .update(entityId)
    .update("\0")
    .update(source)
    .digest("hex")
}

function resourceUrl(record: AvatarCacheRecord): string {
  return `jiying-avatar://cache/${record.resourceKey}?v=${record.downloadedAt}`
}

function extensionFor(contentType: string): string {
  return (
    {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/svg+xml": "svg",
    }[contentType] ?? "png"
  )
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

async function removeFile(filePath: string) {
  await unlink(filePath).catch(() => undefined)
}
