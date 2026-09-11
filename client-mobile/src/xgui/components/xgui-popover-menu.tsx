import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import {
  Animated,
  BackHandler,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Svg, { Path } from "react-native-svg"
import { Portal } from "tamagui"

import {
  calculateXGUIPopoverLayout,
  type XGUIPopoverLayout,
  type XGUIPopoverPlacement,
} from "@/xgui/components/xgui-popover-menu-model"
import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIPopoverAnchor = {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void
}

export type XGUIPopoverMenuItem = {
  accessibilityLabel?: string
  destructive?: boolean
  disabled?: boolean
  icon?: (props: { color: string; size: number; strokeWidth: number }) => ReactNode
  label: string
  onPress: () => void
}

export type XGUIPopoverMenuProps = {
  anchorRef: RefObject<XGUIPopoverAnchor | null>
  backgroundColor?: string
  foregroundColor?: string
  items: readonly XGUIPopoverMenuItem[]
  onOpenChange: (open: boolean) => void
  open: boolean
  placement?: XGUIPopoverPlacement
  width?: number
}

const ANIMATION_DURATION = 150
const ARROW_HEIGHT = 8
const ARROW_WIDTH = 16
const ITEM_HEIGHT = 48

export function XGUIPopoverMenu({
  anchorRef,
  backgroundColor,
  foregroundColor,
  items,
  onOpenChange,
  open,
  placement = "bottom-end",
  width = 220,
}: XGUIPopoverMenuProps) {
  const { colors } = useXGUITheme()
  const menuBackground = backgroundColor ?? colors.background4
  const menuForeground = foregroundColor ?? colors.textOnColor
  const insets = useSafeAreaInsets()
  const [rendered, setRendered] = useState(false)
  const [layout, setLayout] = useState<XGUIPopoverLayout | null>(null)
  const [progress] = useState(() => new Animated.Value(0.01))
  const animationRef = useRef<Animated.CompositeAnimation | null>(null)
  const openRef = useRef(open)

  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const measure = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) {
      close()
      return
    }
    anchor.measureInWindow((x, y, anchorWidth, anchorHeight) => {
      if (!openRef.current) return
      if (anchorWidth <= 0 || anchorHeight <= 0) {
        close()
        return
      }
      const window = Dimensions.get("window")
      setLayout(
        calculateXGUIPopoverLayout({
          anchor: { height: anchorHeight, width: anchorWidth, x, y },
          insets,
          menuHeight: items.length * ITEM_HEIGHT,
          menuWidth: width,
          placement,
          windowHeight: window.height,
          windowWidth: window.width,
        })
      )
      setRendered(true)
    })
  }, [anchorRef, close, insets, items.length, placement, width])

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    animationRef.current?.stop()
    if (open) {
      if (!rendered) measure()
      return
    }
    if (!rendered) return

    const animation = Animated.timing(progress, {
      duration: ANIMATION_DURATION,
      toValue: 0,
      useNativeDriver: true,
    })
    animationRef.current = animation
    animation.start(({ finished }) => {
      if (finished && !openRef.current) {
        setRendered(false)
        setLayout(null)
      }
    })
  }, [measure, open, progress, rendered])

  useEffect(() => {
    if (!open || !layout || !rendered) return
    animationRef.current?.stop()
    progress.setValue(0.01)
    let animationFrame: number | undefined
    const preparationFrame = requestAnimationFrame(() => {
      animationFrame = requestAnimationFrame(() => {
        const animation = Animated.timing(progress, {
          duration: ANIMATION_DURATION,
          toValue: 1,
          useNativeDriver: true,
        })
        animationRef.current = animation
        animation.start()
      })
    })
    return () => {
      cancelAnimationFrame(preparationFrame)
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
    }
  }, [layout, open, progress, rendered])

  useEffect(
    () => () => {
      animationRef.current?.stop()
    },
    []
  )

  useEffect(() => {
    if (!open) return
    const subscription = Dimensions.addEventListener("change", measure)
    return () => subscription.remove()
  }, [measure, open])

  useEffect(() => {
    if (!rendered) return
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      close()
      return true
    })
    return () => subscription.remove()
  }, [close, rendered])

  const pressItem = (item: XGUIPopoverMenuItem) => {
    if (item.disabled) return
    close()
    setTimeout(item.onPress, ANIMATION_DURATION)
  }

  if (!rendered || !layout) return null

  const isBottom = layout.placement.startsWith("bottom")
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [isBottom ? -4 : 4, 0],
  })

  return (
    <Portal stackZIndex={100_000}>
      <View accessibilityViewIsModal style={styles.portal}>
        <Pressable accessibilityRole="button" onPress={close} style={styles.fill} />
        <Animated.View
          needsOffscreenAlphaCompositing
          renderToHardwareTextureAndroid
          shouldRasterizeIOS
          style={[
            styles.positioned,
            {
              left: layout.menuX,
              opacity: progress,
              paddingBottom: isBottom ? 0 : ARROW_HEIGHT,
              paddingTop: isBottom ? ARROW_HEIGHT : 0,
              top: layout.menuY - (isBottom ? ARROW_HEIGHT : 0),
              transform: [{ translateY }],
              width,
            },
          ]}
        >
          <Svg
            height={ARROW_HEIGHT}
            pointerEvents="none"
            style={[
              styles.arrow,
              {
                left: layout.arrowX,
                transform: [{ rotate: isBottom ? "0deg" : "180deg" }],
                [isBottom ? "top" : "bottom"]: 0,
              },
            ]}
            viewBox={`0 0 ${ARROW_WIDTH} ${ARROW_HEIGHT}`}
            width={ARROW_WIDTH}
          >
            <Path
              d="M0 8 L7.2 0.8 Q8 0 8.8 0.8 L16 8 Z"
              fill={menuBackground}
            />
          </Svg>
          <View
            accessibilityRole="menu"
            style={[styles.menu, { backgroundColor: menuBackground }]}
          >
            {items.map((item, index) => {
              const color = item.destructive ? colors.destructive : menuForeground
              return (
                <Pressable
                  accessibilityLabel={item.accessibilityLabel ?? item.label}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: item.disabled }}
                  disabled={item.disabled}
                  key={`${item.label}-${index}`}
                  onPress={() => pressItem(item)}
                  style={({ pressed }) => [
                    styles.item,
                    item.disabled && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  {item.icon?.({ color, size: 24, strokeWidth: 2 })}
                  <Text numberOfLines={1} style={[styles.label, { color }]}>
                    {item.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </Animated.View>
      </View>
    </Portal>
  )
}

const styles = StyleSheet.create({
  arrow: {
    position: "absolute",
    zIndex: 1,
  },
  disabled: { opacity: 0.4 },
  fill: StyleSheet.absoluteFill,
  item: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    height: ITEM_HEIGHT,
    paddingHorizontal: 16,
  },
  label: { flex: 1, fontSize: 18, lineHeight: 24 },
  menu: {
    borderRadius: 4,
    elevation: 8,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 8,
  },
  portal: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 100_000,
  },
  positioned: { position: "absolute" },
  pressed: { backgroundColor: "rgba(255,255,255,0.12)" },
})
