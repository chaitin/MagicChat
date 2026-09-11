import { useEffect, useState } from "react"
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUISwitchProps = {
  accessibilityLabel?: string
  disabled?: boolean
  dimWhenDisabled?: boolean
  onValueChange: (value: boolean) => void
  style?: StyleProp<ViewStyle>
  value: boolean
}

const TRACK_ANIMATION_DURATION = 100
const THUMB_ANIMATION_DURATION = 350
const THUMB_EASING = Easing.bezier(0.4, 0.4, 0.25, 1.35)

export function XGUISwitch({
  accessibilityLabel,
  disabled = false,
  dimWhenDisabled = true,
  onValueChange,
  style,
  value,
}: XGUISwitchProps) {
  const { colors } = useXGUITheme()
  const [trackProgress] = useState(
    () => new Animated.Value(value ? 1 : 0)
  )
  const [thumbProgress] = useState(
    () => new Animated.Value(value ? 1 : 0)
  )

  useEffect(() => {
    const trackAnimation = Animated.timing(trackProgress, {
      duration: TRACK_ANIMATION_DURATION,
      easing: Easing.linear,
      toValue: value ? 1 : 0,
      useNativeDriver: false,
    })
    const thumbAnimation = Animated.timing(thumbProgress, {
      duration: THUMB_ANIMATION_DURATION,
      easing: THUMB_EASING,
      toValue: value ? 1 : 0,
      useNativeDriver: true,
    })

    trackAnimation.start()
    thumbAnimation.start()
    return () => {
      trackAnimation.stop()
      thumbAnimation.stop()
    }
  }, [thumbProgress, trackProgress, value])

  const trackColor = trackProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.foreground3, colors.brand],
  })
  const thumbOffset = thumbProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 20],
  })

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[
        styles.container,
        disabled && dimWhenDisabled && styles.disabled,
        style,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.track, { backgroundColor: trackColor }]}
      >
        <Animated.View
          style={[styles.thumb, { transform: [{ translateX: thumbOffset }] }]}
        />
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    height: 32,
    width: 52,
  },
  disabled: {
    opacity: 0.1,
  },
  track: {
    borderRadius: 16,
    flex: 1,
    padding: 2,
  },
  thumb: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    height: 28,
    width: 28,
  },
})
