export type AttachmentResourceKind = "file" | "image" | "voice"

export type AttachmentResourceReference = {
  expectedSizeBytes?: number
  fileId: string
  fileName?: string
  kind: AttachmentResourceKind
  mimeType?: string
  type: "attachment"
}

export type AvatarResourceReference = {
  type: "avatar"
  url: string
}

export type ResourceReference =
  | AttachmentResourceReference
  | AvatarResourceReference

export type ResolvedResource = {
  identity: string
  mimeType?: string
  sizeBytes: number
  source: "cache" | "network"
  uri: string
}

export type ResourceLoadState = {
  error: Error | null
  resource: ResolvedResource | null
  status: "idle" | "loading" | "ready" | "error"
}

export const IDLE_RESOURCE_STATE: ResourceLoadState = {
  error: null,
  resource: null,
  status: "idle",
}
