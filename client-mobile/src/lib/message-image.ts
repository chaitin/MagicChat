import { File } from "expo-file-system"
import { ImageManipulator, SaveFormat } from "expo-image-manipulator"

import type { PreparedClientMessageUpload } from "@/data/message-upload"

export const IMAGE_MESSAGE_MAX_BYTES = 2 * 1024 * 1024

const IMAGE_MESSAGE_MAX_DIMENSION = 1920
const IMAGE_MESSAGE_OUTPUT_QUALITY = 0.82
const IMAGE_MESSAGE_OUTPUT_TYPE = "image/webp"
const acceptedImageTypes = new Set([
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

export async function prepareImageMessage({
  height,
  mimeType,
  name,
  uri,
  width,
}: {
  height: number
  mimeType: string
  name: string
  uri: string
  width: number
}): Promise<PreparedClientMessageUpload> {
  if (!isAcceptedImageMessage({ mimeType, name })) {
    throw new Error("请选择 PNG、JPG 或 WebP 图片")
  }
  if (width <= 0 || height <= 0) {
    throw new Error("读取图片失败")
  }

  const scale = Math.min(
    1,
    IMAGE_MESSAGE_MAX_DIMENSION / Math.max(width, height)
  )
  const outputWidth = Math.max(1, Math.round(width * scale))
  const outputHeight = Math.max(1, Math.round(height * scale))
  const context = ImageManipulator.manipulate(uri)
  let imageRef: Awaited<ReturnType<typeof context.renderAsync>> | null = null

  try {
    if (scale < 1) {
      context.resize({ height: outputHeight, width: outputWidth })
    }

    imageRef = await context.renderAsync()
    const result = await imageRef.saveAsync({
      compress: IMAGE_MESSAGE_OUTPUT_QUALITY,
      format: SaveFormat.WEBP,
    })
    const outputFile = new File(result.uri)

    if (outputFile.size > IMAGE_MESSAGE_MAX_BYTES) {
      deleteFileQuietly(outputFile)
      throw new Error("图片大于 2MB，无法上传")
    }

    return {
      cleanup: () => deleteFileQuietly(outputFile),
      height: result.height,
      kind: "image",
      upload: {
        mimeType: IMAGE_MESSAGE_OUTPUT_TYPE,
        name: createOutputFileName(name),
        sizeBytes: outputFile.size,
        uri: result.uri,
      },
      width: result.width,
    }
  } catch (error: unknown) {
    if (error instanceof Error) throw error
    throw new Error("读取图片失败")
  } finally {
    imageRef?.release()
    context.release()
  }
}

export function isAcceptedImageMessage({
  mimeType,
  name,
}: {
  mimeType: string
  name: string
}) {
  if (acceptedImageTypes.has(mimeType.toLowerCase())) return true
  return /\.(hei[cf]|jpe?g|png|webp)$/i.test(name)
}

function createOutputFileName(fileName: string) {
  const baseName = fileName.trim().replace(/\.[^.]+$/, "") || "image"
  return `${baseName}.webp`
}

function deleteFileQuietly(file: File) {
  try {
    if (file.exists) file.delete()
  } catch {
    // Temporary image cleanup must not affect message delivery.
  }
}
