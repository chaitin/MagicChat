import type { SelectedClientAppAvatar } from "../../shared/account-data"

export async function prepareAppAvatar(
  targetId: string,
  source: SelectedClientAppAvatar,
): Promise<SelectedClientAppAvatar> {
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.decoding = "async"
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error("图片读取失败"))
      image.src = source.resourceUrl
    })
    const width = image.naturalWidth
    const height = image.naturalHeight
    if (width < 64 || height < 64) throw new Error("图片尺寸不能小于 64x64")
    if (width > 4096 || height > 4096) throw new Error("图片尺寸不能超过 4096x4096")

    const canvas = document.createElement("canvas")
    canvas.width = 256
    canvas.height = 256
    const context = canvas.getContext("2d")
    if (!context) throw new Error("无法处理头像图片")
    const size = Math.min(width, height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = "high"
    context.drawImage(image, (width - size) / 2, (height - size) / 2, size, size, 0, 0, 256, 256)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", 0.9)
    })
    if (!blob || blob.type !== "image/webp") throw new Error("无法将头像转换为 WebP")
    if (blob.size > 1024 * 1024) throw new Error("处理后的头像文件不能超过 1MiB")
    const name = `${source.name.trim().replace(/\.[^.]+$/, "") || "avatar"}.webp`
    const result = await window.desktop!.accountData.importMessageFile({
      targetId,
      file: new File([blob], name, { type: "image/webp" }),
    })
    if (!result.ok) throw new Error(result.error.message)
    if (!("resourceUrl" in result.data)) throw new Error("无法暂存头像图片")
    return {
      token: result.data.token,
      name,
      sizeBytes: blob.size,
      contentType: "image/webp",
      resourceUrl: result.data.resourceUrl,
    }
  } finally {
    await window
      .desktop!.accountData.releaseMessageFile({ targetId, token: source.token })
      .catch(() => null)
  }
}
