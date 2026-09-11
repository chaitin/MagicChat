import { File } from "expo-file-system"
import * as MediaLibrary from "expo-media-library"
import { Platform } from "react-native"

import type { ResolvedResource } from "@/core/resource-models"

export class MediaLibraryPermissionError extends Error {
  constructor() {
    super("没有保存图片到相册的权限")
    this.name = "MediaLibraryPermissionError"
  }
}

export async function saveImageToMediaLibrary(resource: ResolvedResource) {
  if (Platform.OS === "web") {
    throw new Error("网页端暂不支持保存到系统相册")
  }

  const file = new File(resource.uri)
  if (!file.exists) {
    throw new Error("缓存图片不存在，请重新下载")
  }

  const currentPermission = await MediaLibrary.getPermissionsAsync(true)
  const permission = currentPermission.granted
    ? currentPermission
    : await MediaLibrary.requestPermissionsAsync(true)

  if (!permission.granted) throw new MediaLibraryPermissionError()

  await MediaLibrary.Asset.create(file.uri)
}
