import * as DocumentPicker from "expo-document-picker"
import { File } from "expo-file-system"
import * as ImagePicker from "expo-image-picker"

import type { PreparedClientMessageUpload } from "@/data/messages/message-upload"
import { prepareImageMessage } from "@/data/messages/message-image"
import {
  MediaPermissionSettingsRequiredError,
  requestPermissionForUserAction,
} from "@/features/permissions/media-permission"

export const FILE_MESSAGE_MAX_BYTES = 500 * 1024 * 1024
export const VIDEO_MESSAGE_MAX_BYTES = 100 * 1024 * 1024

export async function pickCameraImageMessage() {
  const permission = await requestPermissionForUserAction(
    ImagePicker.getCameraPermissionsAsync,
    ImagePicker.requestCameraPermissionsAsync
  )
  if (permission === "denied") return null
  if (permission === "settings") {
    throw new MediaPermissionSettingsRequiredError("camera")
  }

  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: false,
    exif: false,
    mediaTypes: ["images"],
    quality: 1,
  })

  return preparePickedImage(result, "camera.jpg", "image/jpeg")
}

export function prepareVideoMessage(input: {
  mimeType?: string
  name: string
  sizeBytes: number
  uri: string
}): PreparedClientMessageUpload {
  const name = input.name.trim() || "video.mp4"
  const mimeType = normalizeVideoMimeType(input.mimeType ?? "", name)
  if (!mimeType) {
    throw new Error("请选择 MP4 或 WebM 视频")
  }
  if (input.sizeBytes <= 0) throw new Error("视频不能为空")
  if (input.sizeBytes > VIDEO_MESSAGE_MAX_BYTES) {
    throw new Error("视频大于 100MiB，无法上传")
  }
  return {
    kind: "video",
    upload: {
      mimeType,
      name,
      sizeBytes: input.sizeBytes,
      uri: input.uri,
    },
  }
}

export async function pickLibraryImageMessage() {
  const permission = await requestPermissionForUserAction(
    ImagePicker.getMediaLibraryPermissionsAsync,
    ImagePicker.requestMediaLibraryPermissionsAsync
  )
  if (permission === "denied") return null
  if (permission === "settings") {
    throw new MediaPermissionSettingsRequiredError("photos")
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: false,
    exif: false,
    mediaTypes: ["images"],
    quality: 1,
  })

  return preparePickedImage(result, "image", "")
}

export async function pickFileMessage(): Promise<PreparedClientMessageUpload | null> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: "*/*",
  })

  if (result.canceled) return null

  const asset = result.assets[0]
  if (!asset) return null

  const file = new File(asset.uri)
  const sizeBytes = asset.size ?? file.size
  if (sizeBytes > FILE_MESSAGE_MAX_BYTES) {
    throw new Error("文件大于 500MiB，无法上传")
  }

  return {
    kind: "file",
    upload: {
      mimeType: asset.mimeType || file.type || "application/octet-stream",
      name: asset.name.trim() || file.name || "attachment",
      sizeBytes,
      uri: asset.uri,
    },
  }
}

function normalizeVideoMimeType(mimeType: string, name: string) {
  if (mimeType === "video/mp4" || mimeType === "video/webm") return mimeType
  if (/\.mp4$/i.test(name)) return "video/mp4"
  if (/\.webm$/i.test(name)) return "video/webm"
  return null
}

async function preparePickedImage(
  result: ImagePicker.ImagePickerResult,
  fallbackName: string,
  fallbackMimeType: string
) {
  if (result.canceled) return null

  const asset = result.assets[0]
  if (!asset) return null
  const file = new File(asset.uri)

  return prepareImageMessage({
    height: asset.height,
    mimeType: asset.mimeType || file.type || fallbackMimeType,
    name: asset.fileName?.trim() || file.name || fallbackName,
    uri: asset.uri,
    width: asset.width,
  })
}
