import { useEffect, useState } from "react"
import { Animated, Easing } from "react-native"
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Stop,
} from "react-native-svg"

export function XGUILoadingIcon({
  color,
  size,
}: {
  color: string
  size: number
}) {
  const [rotation] = useState(() => new Animated.Value(0))

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(rotation, {
        duration: 1_000,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      })
    )
    animation.start()
    return () => animation.stop()
  }, [rotation])

  return (
    <Animated.View
      style={{
        height: size,
        transform: [
          {
            rotate: rotation.interpolate({
              inputRange: [0, 1],
              outputRange: ["0deg", "360deg"],
            }),
          },
        ],
        width: size,
      }}
    >
      <Svg height={size} viewBox="0 0 80 80" width={size}>
        <Defs>
          <LinearGradient
            id="weuiLoadingFade"
            x1="94.0869141%"
            x2="94.0869141%"
            y1="0%"
            y2="90.559082%"
          >
            <Stop offset="0%" stopColor={color} stopOpacity={0} />
            <Stop offset="100%" stopColor={color} stopOpacity={0.3} />
          </LinearGradient>
          <LinearGradient
            id="weuiLoadingSolid"
            x1="100%"
            x2="100%"
            y1="8.67370605%"
            y2="90.6286621%"
          >
            <Stop offset="0%" stopColor={color} />
            <Stop offset="100%" stopColor={color} stopOpacity={0.3} />
          </LinearGradient>
        </Defs>
        <G fill="none" fillRule="evenodd" opacity={0.9} stroke="none">
          <Path
            d="M40 0C62.09139 0 80 17.90861 80 40S62.09139 80 40 80v-7c18.2253967 0 33-14.7746033 33-33S58.2253967 7 40 7V0z"
            fill="url(#weuiLoadingFade)"
          />
          <Path
            d="M40 0v7C21.7746033 7 7 21.7746033 7 40s14.7746033 33 33 33v7C17.90861 80 0 62.09139 0 40S17.90861 0 40 0z"
            fill="url(#weuiLoadingSolid)"
          />
          <Circle cx="40.5" cy="3.5" fill={color} r="3.5" />
        </G>
      </Svg>
    </Animated.View>
  )
}
