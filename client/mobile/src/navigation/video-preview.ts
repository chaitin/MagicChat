import type { Href } from "expo-router"

import type { ClientVideoMessageBody } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"

export type VideoPreviewSource = Pick<ClientVideoMessageBody, "fileId" | "contentType" | "name" | "sizeBytes">
export type VideoPreviewParams = Partial<Record<"fileId" | "contentType" | "name" | "sizeBytes" | "scope", string | string[]>>

export function buildVideoPreviewScope(session: AuthenticatedTarget, generation: number) {
  return JSON.stringify([session.id, session.url, session.userId, generation])
}

export function buildVideoPreviewHref(source: VideoPreviewSource, scope: string): Href {
  return {
    pathname: "/video-preview",
    params: {
      fileId: source.fileId,
      contentType: source.contentType,
      name: source.name,
      sizeBytes: String(source.sizeBytes),
      scope,
    },
  } as unknown as Href
}

export function parseVideoPreviewParams(params: VideoPreviewParams): { source: VideoPreviewSource; scope: string } | null {
  const fileId = first(params.fileId).trim()
  const contentType = first(params.contentType)
  const name = first(params.name).trim()
  const sizeBytes = Number(first(params.sizeBytes))
  const scope = first(params.scope)
  if (!fileId || !name || !scope || !Number.isFinite(sizeBytes) || sizeBytes <= 0 ||
      (contentType !== "video/mp4" && contentType !== "video/webm")) return null
  return { source: { fileId, contentType, name, sizeBytes }, scope }
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}
