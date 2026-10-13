import { Asset } from "expo-asset"
import { Platform } from "react-native"
import { requireOptionalNativeModule } from "expo-modules-core"

import type { TextStyle } from "react-native"

const fallbackModule = requireOptionalNativeModule<{
  register: (familyName: string, primaryPath: string, emojiPath: string) => boolean
}>("MagicChatFontFallback")

let ready = false
let pending: Promise<boolean> | null = null

function familySuffix(weight: TextStyle["fontWeight"]) {
  if (weight === "bold" || (weight !== undefined && Number(weight) >= 600)) return "Demibold"
  if (weight !== undefined && Number(weight) >= 500) return "Medium"
  return "Regular"
}

export function getInputFontFamily(weight: TextStyle["fontWeight"], regularFamily: string) {
  if (Platform.OS === "android" && Number(Platform.Version) < 29) return undefined
  if (ready && (Platform.OS === "ios" || (Platform.OS === "android" && Number(Platform.Version) >= 29))) {
    return `MiSansEmojiFallback-${familySuffix(weight)}`
  }
  return regularFamily
}

export function initializeInputEmojiFallback() {
  if (pending) return pending
  if (!fallbackModule || (Platform.OS !== "ios" && Platform.OS !== "android") || (Platform.OS === "android" && Number(Platform.Version) < 29)) {
    return Promise.resolve(false)
  }
  pending = Promise.all([
    Asset.fromModule(require("../../assets/fonts/misans/MiSans-Regular.ttf")).downloadAsync(),
    Asset.fromModule(require("../../assets/fonts/misans/MiSans-Medium.ttf")).downloadAsync(),
    Asset.fromModule(require("../../assets/fonts/misans/MiSans-Demibold.ttf")).downloadAsync(),
    Asset.fromModule(Platform.OS === "ios"
      ? require("../../assets/fonts/emoji/JiyingEmojiIOS.ttf")
      : require("../../assets/fonts/emoji/JiyingEmojiAndroid.ttf")).downloadAsync(),
  ]).then(([regular, medium, demibold, emoji]) => {
    const definitions = [
      ["Regular", regular],
      ["Medium", medium],
      ["Demibold", demibold],
    ] as const
    if (!emoji.localUri) return false
    const registered = definitions.every(([suffix, asset]) =>
      Boolean(asset.localUri && fallbackModule.register(`MiSansEmojiFallback-${suffix}`, asset.localUri, emoji.localUri!)),
    )
    ready = registered
    return registered
  }).catch(() => false)
  return pending
}
