const avatarOutputSize = 256
const avatarMinSourceSize = 64
const avatarMaxSourceSize = 4096
const avatarMaxSourceBytes = 5 * 1024 * 1024
const avatarMaxOutputBytes = 1 * 1024 * 1024
const avatarOutputType = "image/webp"
const avatarOutputQuality = 0.9

const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"])

export type PreparedAppAvatar = {
  file: File
  previewUrl: string
}

export async function prepareAppAvatar(
  sourceFile: File
): Promise<PreparedAppAvatar> {
  if (!acceptedImageTypes.has(sourceFile.type)) {
    throw new Error("请选择 PNG、JPG 或 WebP 图片")
  }
  if (sourceFile.size > avatarMaxSourceBytes) {
    throw new Error("图片文件不能超过 5MiB")
  }

  const sourceUrl = URL.createObjectURL(sourceFile)
  try {
    const image = await loadImage(sourceUrl)
    validateImageSize(image.naturalWidth, image.naturalHeight)

    const canvas = document.createElement("canvas")
    canvas.height = avatarOutputSize
    canvas.width = avatarOutputSize
    const context = canvas.getContext("2d")

    if (!context) {
      throw new Error("无法处理头像图片")
    }

    const crop = calculateCenterSquareCrop(
      image.naturalWidth,
      image.naturalHeight
    )
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = "high"
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.size,
      crop.size,
      0,
      0,
      avatarOutputSize,
      avatarOutputSize
    )

    const previewUrl = canvas.toDataURL(avatarOutputType, avatarOutputQuality)
    const blob =
      (await canvasToBlob(canvas, avatarOutputType, avatarOutputQuality)) ??
      dataUrlToBlob(previewUrl)

    if (blob.size > avatarMaxOutputBytes) {
      throw new Error("处理后的头像文件不能超过 1MiB")
    }

    return {
      file: new File([blob], createAvatarFileName(sourceFile.name), {
        type: blob.type || avatarOutputType,
      }),
      previewUrl,
    }
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

export function calculateCenterSquareCrop(width: number, height: number) {
  const size = Math.min(width, height)

  return {
    size,
    x: (width - size) / 2,
    y: (height - size) / 2,
  }
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = "async"
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("图片读取失败"))
    image.src = source
  })
}

function validateImageSize(width: number, height: number) {
  if (width < avatarMinSourceSize || height < avatarMinSourceSize) {
    throw new Error("图片尺寸不能小于 64x64")
  }
  if (width > avatarMaxSourceSize || height > avatarMaxSourceSize) {
    throw new Error("图片尺寸不能超过 4096x4096")
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality)
  })
}

function dataUrlToBlob(dataUrl: string) {
  const [metadata, content = ""] = dataUrl.split(",")
  const mimeType = metadata.match(/^data:(.*?);/)?.[1] || avatarOutputType
  const binary = atob(content)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: mimeType })
}

function createAvatarFileName(fileName: string) {
  const baseName = fileName.trim().replace(/\.[^.]+$/, "") || "avatar"

  return `${baseName}.webp`
}
