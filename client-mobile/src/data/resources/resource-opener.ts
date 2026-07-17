import { File } from "expo-file-system"
import * as IntentLauncher from "expo-intent-launcher"
import * as Sharing from "expo-sharing"
import { Linking, Platform } from "react-native"

import type { ResolvedResource } from "@/data/resources/resource-types"

const FLAG_GRANT_READ_URI_PERMISSION = 1

export async function openResourceExternally(resource: ResolvedResource) {
  if (Platform.OS === "web" || !resource.uri.startsWith("file:")) {
    await Linking.openURL(resource.uri)
    return
  }

  const file = new File(resource.uri)
  if (!file.exists) {
    throw new Error("缓存文件不存在，请重新下载")
  }

  const mimeType = resource.mimeType || file.type || "application/octet-stream"

  if (Platform.OS === "android") {
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: file.contentUri,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
      type: mimeType,
    })
    return
  }

  if (Platform.OS === "ios") {
    await Sharing.shareAsync(file.uri, { mimeType })
    return
  }

  await Linking.openURL(file.uri)
}
