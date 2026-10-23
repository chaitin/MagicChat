import { useLayoutEffect, useState } from "react"
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from "react-native"
import { useReducedMotion } from "react-native-reanimated"

import { useXGUITheme } from "@/xgui"

export function MessageHighlightOutline({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useXGUITheme()
  const [opacity] = useState(() => new Animated.Value(1))
  const reducedMotion = useReducedMotion()

  useLayoutEffect(() => {
    opacity.setValue(1)
    if (reducedMotion) return
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: 2_000,
      easing: Easing.linear,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [opacity, reducedMotion])

  return (
    <Animated.View
      accessible={false}
      pointerEvents="none"
      style={[styles.outline, style, { borderColor: colors.orange, opacity }]}
    />
  )
}

const styles = StyleSheet.create({
  outline: {
    position: "absolute",
    top: -2,
    bottom: -2,
    left: -2,
    right: -2,
    borderWidth: 2,
    borderRadius: 6,
  },
})
