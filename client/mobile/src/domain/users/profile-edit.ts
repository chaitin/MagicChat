export type AvatarSourceMetadata = {
  fileName?: string | null
  fileSize?: number
  height: number
  mimeType?: string
  width: number
}

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"])

export function validateAvatarSource(source: AvatarSourceMetadata): string | null {
  const mimeType = source.mimeType?.toLowerCase()
  const hasFileName = Boolean(source.fileName)
  const hasTypeMetadata = Boolean(mimeType || hasFileName)
  const isSupportedType =
    (mimeType !== undefined && acceptedTypes.has(mimeType)) ||
    (hasFileName && /\.(jpe?g|png|webp)$/i.test(source.fileName ?? ""))
  if (hasTypeMetadata && !isSupportedType)
    return "请选择 PNG、JPG 或 WebP 图片"
  if ((source.fileSize ?? 0) > 5 * 1024 * 1024) return "图片文件不能超过 5MiB"
  if (source.width < 64 || source.height < 64) return "图片尺寸不能小于 64x64"
  if (source.width > 4096 || source.height > 4096) return "图片尺寸不能超过 4096x4096"
  return null
}

export function createNicknameRequest(nickname: string) {
  return {
    body: JSON.stringify({ nickname: nickname.trim() }),
    headers: { "Content-Type": "application/json" },
    method: "PATCH" as const,
  }
}
