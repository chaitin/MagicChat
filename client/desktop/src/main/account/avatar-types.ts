import type { AvatarType } from "../../shared/account-data"

export type AvatarMemberDescriptor = {
  type: "user" | "app"
  id: string
  name: string
  avatarUrl: string
  role: "owner" | "admin" | "member"
}

export type AvatarDescriptor = {
  type: Exclude<AvatarType, "topic">
  id: string
  name: string
  avatarUrl: string
  members?: AvatarMemberDescriptor[]
}

export type AvatarCacheRecord = {
  type: string
  entityId: string
  sourceUrl: string
  localFile: string
  contentType: string
  resourceKey: string
  downloadedAt: number
  checkedAt: number
}

export type AvatarResource = {
  contentType: string
  bytes: Uint8Array
}
