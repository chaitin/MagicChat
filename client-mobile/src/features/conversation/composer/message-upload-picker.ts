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
