import type { ReactElement } from "react"
import {
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"

import {
  canStartElasticOverscroll,
  getElasticTranslation,
} from "@/components/layout/elastic-overscroll-model"

export type ElasticScrollBindings = {
  onContentSizeChange: (width: number, height: number) => void
  onLayout: (event: LayoutChangeEvent) => void
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  scrollEventThrottle: number
}

export function ElasticOverscroll({
  children,
}: {
  children: (bindings: ElasticScrollBindings) => ReactElement
}) {
  const offsetY = useSharedValue(0)
  const viewportHeight = useSharedValue(0)
  const contentHeight = useSharedValue(0)
  const translationY = useSharedValue(0)
  const touchStartX = useSharedValue(0)
  const touchStartY = useSharedValue(0)

  const bindings: ElasticScrollBindings = {
    onContentSizeChange: (_width, height) => { contentHeight.value = height },
    onLayout: (event) => { viewportHeight.value = event.nativeEvent.layout.height },
    onScroll: (event) => { offsetY.value = Math.max(0, event.nativeEvent.contentOffset.y) },
    scrollEventThrottle: 16,
  }

  const nativeGesture = Gesture.Native()
  const panGesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((event) => {
      const touch = event.allTouches[0]
      if (!touch) return
      touchStartX.value = touch.absoluteX
      touchStartY.value = touch.absoluteY
    })
    .onTouchesMove((event, stateManager) => {
      const touch = event.allTouches[0]
      if (!touch) return

      const dragX = touch.absoluteX - touchStartX.value
      const dragY = touch.absoluteY - touchStartY.value
      if (Math.abs(dragX) > 12 && Math.abs(dragX) > Math.abs(dragY)) {
        stateManager.fail()
        return
      }
      if (Math.abs(dragY) <= 4) return

      if (
        canStartElasticOverscroll(dragY, {
          contentHeight: contentHeight.value,
          offsetY: offsetY.value,
          viewportHeight: viewportHeight.value,
        })
      ) {
        stateManager.activate()
      } else {
        stateManager.fail()
      }
    })
    .onUpdate((event) => {
      translationY.value = getElasticTranslation(event.translationY, {
        contentHeight: contentHeight.value,
        offsetY: offsetY.value,
        viewportHeight: viewportHeight.value,
      })
    })
    .onFinalize(() => {
      translationY.value = withTiming(0, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      })
    })
    .simultaneousWithExternalGesture(nativeGesture)
  nativeGesture.simultaneousWithExternalGesture(panGesture)
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translationY.value }],
  }))

  if (Platform.OS !== "android") return <View style={styles.fill}>{children(bindings)}</View>

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[styles.fill, animatedStyle]}>
        <GestureDetector gesture={nativeGesture}>
          {children(bindings)}
        </GestureDetector>
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({ fill: { flex: 1, minHeight: 0 } })
