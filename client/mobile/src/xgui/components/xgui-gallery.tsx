/* eslint-disable react-hooks/immutability -- Reanimated shared values are intentionally mutated by UI-thread gesture worklets. */
import { Download } from "lucide-react-native"
import { useEffect, useState } from "react"
import {
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native"
import { File } from "expo-file-system"
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler"
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { SvgUri, SvgXml } from "react-native-svg"

import { XGUILoadingIcon } from "@/xgui/components/xgui-loading-icon"

export type XGUIGallerySource = {
  uri: string
  /** Set this when a cached/local URI no longer has the original .svg suffix. */
  svg?: boolean
}

export type XGUIGalleryProps = {
  accessibilityLabel: string
  maxScale?: number
  onError?: () => void
  onLoad?: () => void
  onOpenChange: (open: boolean) => void
  onSave: () => void
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  open: boolean
  saving?: boolean
  source: XGUIGallerySource
}

export function XGUIGallery({
  accessibilityLabel,
  maxScale = 4,
  onError,
  onLoad,
  onOpenChange,
  onSave,
  onSwipeLeft,
  onSwipeRight,
  open,
  saving = false,
  source,
}: XGUIGalleryProps) {
  const insets = useSafeAreaInsets()
  const opacity = useSharedValue(0)
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)

  useEffect(() => {
    if (open) {
      scale.value = 1
      savedScale.value = 1
      translateX.value = 0
      translateY.value = 0
      savedX.value = 0
      savedY.value = 0
      opacity.value = 0
      opacity.value = withTiming(1, { duration: 100 })
    }
  }, [opacity, open, savedScale, savedX, savedY, scale, translateX, translateY])

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(maxScale, Math.max(1, savedScale.value * event.scale))
    })
    .onEnd(() => {
      savedScale.value = scale.value
      if (scale.value <= 1) {
        translateX.value = withTiming(0)
        translateY.value = withTiming(0)
        savedX.value = 0
        savedY.value = 0
      }
    })

  const pan = Gesture.Pan()
    .minPointers(1)
    .onUpdate((event) => {
      if (scale.value > 1) {
        translateX.value = savedX.value + event.translationX
        translateY.value = savedY.value + event.translationY
      }
    })
    .onEnd((event) => {
      if (scale.value <= 1) {
        if (event.translationX <= -60 && onSwipeLeft) runOnJS(onSwipeLeft)()
        if (event.translationX >= 60 && onSwipeRight) runOnJS(onSwipeRight)()
        translateX.value = 0
        translateY.value = 0
        return
      }
      savedX.value = translateX.value
      savedY.value = translateY.value
    })

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((_event, success) => {
      if (!success) return
      const next = scale.value > 1 ? 1 : Math.min(2, maxScale)
      scale.value = withTiming(next)
      savedScale.value = next
      if (next === 1) {
        translateX.value = withTiming(0)
        translateY.value = withTiming(0)
        savedX.value = 0
        savedY.value = 0
      }
    })

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd((_event, success) => {
      if (success) runOnJS(onOpenChange)(false)
    })

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }))
  const modalStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))
  const gesture = Gesture.Simultaneous(
    pinch,
    pan,
    Gesture.Exclusive(doubleTap, singleTap)
  )

  return (
    <Modal
      animationType="none"
      onRequestClose={() => onOpenChange(false)}
      statusBarTranslucent
      transparent
      visible={open}
    >
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[styles.modal, modalStyle]}>
          <GestureDetector gesture={gesture}>
            <Animated.View
              accessibilityLabel={accessibilityLabel}
              accessibilityRole="image"
              style={[styles.imageFrame, imageStyle]}
            >
              <GalleryImage onError={onError} onLoad={onLoad} source={source} />
            </Animated.View>
          </GestureDetector>

          <View
            pointerEvents="box-none"
            style={[
              styles.action,
              { paddingBottom: Math.max(insets.bottom, 12) },
            ]}
          >
            <Pressable
              accessibilityLabel="保存图片到相册"
              accessibilityRole="button"
              accessibilityState={{ busy: saving, disabled: saving }}
              disabled={saving}
              onPress={onSave}
              style={({ pressed }) => [
                styles.saveButton,
                pressed && !saving ? styles.saveButtonPressed : null,
              ]}
            >
              {saving ? (
                <XGUILoadingIcon color="#fff" size={18} />
              ) : (
                <Download color="#fff" size={18} />
              )}
            </Pressable>
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  )
}

function GalleryImage({
  onError,
  onLoad,
  source,
}: {
  onError?: () => void
  onLoad?: () => void
  source: XGUIGallerySource
}) {
  const svg = source.svg ?? isSvgUri(source.uri)
  const [xml, setXml] = useState<string | null>(null)

  useEffect(() => {
    if (!svg || Platform.OS === "web") return
    let active = true
    new File(source.uri).text().then(
      (value) => {
        if (active) setXml(value)
      },
      () => {
        if (active) setXml(null)
      }
    )
    return () => {
      active = false
    }
  }, [source.uri, svg])

  if (svg) {
    const props = { height: "100%" as const, width: "100%" as const }
    return Platform.OS === "web" ? (
      <SvgUri uri={source.uri} {...props} />
    ) : xml ? (
      <SvgXml xml={xml} {...props} />
    ) : null
  }
  return (
    <Image
      onError={onError}
      onLoad={onLoad}
      resizeMode="contain"
      source={{ uri: source.uri }}
      style={styles.image}
    />
  )
}

function isSvgUri(uri: string) {
  return uri.split(/[?#]/, 1)[0]?.toLowerCase().endsWith(".svg") ?? false
}

const styles = StyleSheet.create({
  action: {
    alignItems: "flex-end",
    backgroundColor: "rgba(20,20,20,0.96)",
    bottom: 0,
    left: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    position: "absolute",
    right: 0,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  saveButtonPressed: {
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  image: { height: "100%", width: "100%" },
  imageFrame: {
    height: "100%",
    width: "100%",
  },
  modal: { backgroundColor: "#000", flex: 1 },
  root: { flex: 1 },
})
