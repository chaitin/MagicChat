import { Asset } from "expo-asset"
import { findNodeHandle, Platform, type TextInput, type TextStyle } from "react-native"
import { requireOptionalNativeModule } from "expo-modules-core"

const fallbackModule = requireOptionalNativeModule<{
  registerEmoji?: (emojiPath: string) => boolean
  attachInput?: (tag: number) => void
  detachInput?: (tag: number) => void
  registerSystem?: (familyName: string, emojiPath: string, weight: number) => boolean
}>("MagicChatFontFallback")

let ready = false
let pending: Promise<boolean> | null = null

const namedWeights: Record<string, number> = {
  ultralight: 100, thin: 200, light: 300, normal: 400, regular: 400,
  medium: 500, semibold: 600, bold: 700, heavy: 800, black: 900,
}

export function getInputFontFamily(weight: TextStyle["fontWeight"]) {
  if (!ready || Platform.OS !== "ios") return undefined
  const value = weight === undefined ? 400 : namedWeights[weight] ?? Number(weight)
  const numeric = Number.isFinite(value) ? Math.max(100, Math.min(900, Math.round(value / 100) * 100)) : 400
  return `SystemEmojiFallback-${numeric}`
}

export function attachInputEmojiFallback(input: TextInput | null) {
  if (!ready || Platform.OS !== "android" || !input) return undefined
  const tag = findNodeHandle(input)
  if (tag == null) return undefined
  fallbackModule?.attachInput?.(tag)
  return () => fallbackModule?.detachInput?.(tag)
}

export function initializeInputEmojiFallback() {
  if (pending) return pending
  const android = Platform.OS === "android" && Number(Platform.Version) >= 29
  const ios = Platform.OS === "ios"
  if (!fallbackModule || (!android && !ios)) return Promise.resolve(false)
  if (android && (!fallbackModule.registerEmoji || !fallbackModule.attachInput || !fallbackModule.detachInput)) return Promise.resolve(false)
  if (ios && !fallbackModule.registerSystem) return Promise.resolve(false)

  pending = Asset.fromModule(ios
    ? require("../../assets/fonts/emoji/JiyingEmojiIOS.ttf")
    : require("../../assets/fonts/emoji/JiyingEmojiAndroid.ttf")).downloadAsync().then((emoji) => {
    if (!emoji.localUri) return false
    ready = android
      ? Boolean(fallbackModule.registerEmoji!(emoji.localUri))
      : [100, 200, 300, 400, 500, 600, 700, 800, 900].every(weight =>
        fallbackModule.registerSystem!(`SystemEmojiFallback-${weight}`, emoji.localUri!, weight),
      )
    return ready
  }).catch(() => false)
  return pending
}
