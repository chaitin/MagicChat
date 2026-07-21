import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { StyleSheet, useWindowDimensions } from "react-native"

const MAX_SCALE = 4

export function ZoomableImage({
  onError,
  onLoad,
  onPress,
  uri,
}: {
  onError: () => void
  onLoad: () => void
  onPress: () => void
  uri: string
}) {
  const { height, width } = useWindowDimensions()
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const translationX = useSharedValue(0)
  const translationY = useSharedValue(0)
  const savedTranslationX = useSharedValue(0)
  const savedTranslationY = useSharedValue(0)

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = clampValue(savedScale.value * event.scale, 1, MAX_SCALE)
    })
    .onEnd(() => {
      savedScale.value = scale.value
      if (scale.value === 1) {
        translationX.value = withTiming(0)
        translationY.value = withTiming(0)
        savedTranslationX.value = 0
        savedTranslationY.value = 0
        return
      }

      const maxX = (width * (scale.value - 1)) / 2
      const maxY = (height * (scale.value - 1)) / 2
      const targetX = clampValue(translationX.value, -maxX, maxX)
      const targetY = clampValue(translationY.value, -maxY, maxY)
      translationX.value = withTiming(targetX)
      translationY.value = withTiming(targetY)
      savedTranslationX.value = targetX
      savedTranslationY.value = targetY
    })

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      if (scale.value <= 1) return
      const maxX = (width * (scale.value - 1)) / 2
      const maxY = (height * (scale.value - 1)) / 2
      translationX.value = clampValue(
        savedTranslationX.value + event.translationX,
        -maxX,
        maxX
      )
      translationY.value = clampValue(
        savedTranslationY.value + event.translationY,
        -maxY,
        maxY
      )
    })
    .onEnd(() => {
      savedTranslationX.value = translationX.value
      savedTranslationY.value = translationY.value
    })

  const tap = Gesture.Tap()
    .maxDistance(8)
    .runOnJS(true)
    .onEnd((_event, success) => {
      if (success) onPress()
    })

  const gesture = Gesture.Simultaneous(pinch, pan, tap)
  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translationX.value },
      { translateY: translationY.value },
      { scale: scale.value },
    ],
  }))

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={styles.viewport}>
        <Animated.Image
          onError={onError}
          onLoad={onLoad}
          resizeMode="contain"
          source={{ uri }}
          style={[styles.image, imageStyle]}
        />
      </Animated.View>
    </GestureDetector>
  )
}

function clampValue(value: number, minimum: number, maximum: number) {
  "worklet"
  return Math.min(Math.max(value, minimum), maximum)
}

const styles = StyleSheet.create({
  image: {
    height: "100%",
    width: "100%",
  },
  viewport: {
    flex: 1,
    overflow: "hidden",
  },
})
