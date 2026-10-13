import ArrowMoveDownRightIcon from "@hugeicons/core-free-icons/dist/esm/ArrowMoveDownRightIcon"
import DocumentAttachmentIcon from "@hugeicons/core-free-icons/dist/esm/DocumentAttachmentIcon"
import Download01Icon from "@hugeicons/core-free-icons/dist/esm/Download01Icon"
import ExternalLinkIcon from "@hugeicons/core-free-icons/dist/esm/ExternalLinkIcon"
import Folder02Icon from "@hugeicons/core-free-icons/dist/esm/Folder02Icon"
import Loading03Icon from "@hugeicons/core-free-icons/dist/esm/Loading03Icon"
import MessageMultiple02Icon from "@hugeicons/core-free-icons/dist/esm/MessageMultiple02Icon"
import PauseCircleIcon from "@hugeicons/core-free-icons/dist/esm/PauseCircleIcon"
import PlayCircle02Icon from "@hugeicons/core-free-icons/dist/esm/PlayCircle02Icon"
import Volume02Icon from "@hugeicons/core-free-icons/dist/esm/Volume02Icon"
import { useEffect, useState, type ReactNode } from "react"
import { Animated, Easing } from "react-native"
import Svg, { Circle, Path } from "react-native-svg"

// Individual imports keep the rest of the icon catalog out of the mobile bundle.
const icons = {
  "topic-arrow": ArrowMoveDownRightIcon,
  attachment: DocumentAttachmentIcon,
  download: Download01Icon,
  open: Folder02Icon,
  loading: Loading03Icon,
  link: ExternalLinkIcon,
  forward: MessageMultiple02Icon,
  voice: Volume02Icon,
  play: PlayCircle02Icon,
  pause: PauseCircleIcon,
}

export type MessageContentIconKind = keyof typeof icons

export function MessageContentIcon({ kind, color, size, strokeWidth = size === 28 ? 1.5 : 2 }: {
  kind: MessageContentIconKind
  color: string
  size: number
  strokeWidth?: number
}) {
  const icon = (
    <Svg height={size} width={size} viewBox="0 0 24 24" fill="none">
      {icons[kind].map(([tag, attributes]) => {
        const paint = {
          fill: attributes.fill === "currentColor" ? color : "none",
          stroke: attributes.stroke === "currentColor" ? color : "none",
          strokeWidth,
          strokeLinecap: attributes.strokeLinecap,
          strokeLinejoin: attributes.strokeLinejoin,
        }
        return tag === "circle" ? (
          <Circle key={attributes.key} cx={attributes.cx} cy={attributes.cy} r={attributes.r} {...paint} />
        ) : (
          <Path key={attributes.key} d={attributes.d} {...paint} />
        )
      })}
    </Svg>
  )
  return kind === "loading" ? <RotatingMessageIcon size={size}>{icon}</RotatingMessageIcon> : icon
}

function RotatingMessageIcon({ children, size }: { children: ReactNode; size: number }) {
  const [rotation] = useState(() => new Animated.Value(0))
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(rotation, {
      duration: 1_000,
      easing: Easing.linear,
      toValue: 1,
      useNativeDriver: true,
    }))
    animation.start()
    return () => animation.stop()
  }, [rotation])

  return (
    <Animated.View style={{
      height: size,
      width: size,
      transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
    }}>
      {children}
    </Animated.View>
  )
}
