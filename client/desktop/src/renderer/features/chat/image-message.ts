import type { SelectedMessageMedia } from "../../../shared/account-data"

export const imageMessageMaxBytes = 2 * 1024 * 1024
const imageMessageMaxDimension = 1920
const imageMessageOutputQuality = 0.82

export type PreparedImageMessage = {
  blob: Blob
  height: number
  name: string
  resourceUrl: string
  width: number
}

export async function prepareImageMessage(selected: SelectedMessageMedia) {
  if (selected.category !== "image") throw new Error("请选择 PNG、JPG 或 WebP 图片")
  const response = await fetch(selected.resourceUrl)
  if (!response.ok) throw new Error("读取图片失败")
  const sourceBlob = await response.blob()
  const sourceUrl = URL.createObjectURL(sourceBlob)
  try {
    const image = await loadImage(sourceUrl)
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error("读取图片失败")
    const scale = Math.min(
      1,
      imageMessageMaxDimension / Math.max(image.naturalWidth, image.naturalHeight),
    )
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("读取图片失败")
    context.drawImage(image, 0, 0, width, height)
    const encoded = await encodeImage(canvas)
    if (encoded.blob.size > imageMessageMaxBytes) throw new Error("图片大于 2MB，无法上传")
    const resourceUrl = URL.createObjectURL(encoded.blob)
    return {
      blob: encoded.blob,
      height,
      name: imageFileName(selected.name, encoded.extension),
      resourceUrl,
      width,
    } satisfies PreparedImageMessage
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("读取图片失败"))
    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
}

async function encodeImage(canvas: HTMLCanvasElement) {
  const webp = await canvasToBlob(canvas, "image/webp", imageMessageOutputQuality)
  if (webp && (await isWebP(webp))) {
    return { blob: webp, extension: "webp", type: "image/webp" as const }
  }
  const png = await canvasToBlob(canvas, "image/png")
  if (!png || png.type.toLowerCase() !== "image/png") throw new Error("转换图片失败")
  return { blob: png, extension: "png", type: "image/png" as const }
}

async function isWebP(blob: Blob) {
  if (blob.type.toLowerCase() !== "image/webp" || blob.size < 12) return false
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  return ascii(header, 0, "RIFF") && ascii(header, 8, "WEBP")
}

function ascii(bytes: Uint8Array, offset: number, value: string) {
  return Array.from(value).every(
    (character, index) => bytes[offset + index] === character.charCodeAt(0),
  )
}

function imageFileName(fileName: string, extension: string) {
  const baseName = fileName.trim().replace(/\.[^.]+$/, "") || "image"
  return `${baseName}.${extension}`
}
