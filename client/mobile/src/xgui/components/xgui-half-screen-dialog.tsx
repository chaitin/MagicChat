import { X } from "lucide-react-native"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Portal } from "tamagui"

import {
  getXGUISheetDragTranslateY,
  XGUI_SHEET_BOTTOM_OVERSCAN,
  XGUI_SHEET_CLOSE_DURATION_MS,
  XGUI_SHEET_OPEN_DURATION_MS,
  XGUI_SHEET_SPRING_CONFIG,
} from "@/xgui/components/xgui-sheet-motion"
import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

const HALF_SCREEN_HEIGHT_RATIO = 0.75
const HALF_SCREEN_OPEN_EASING = Easing.out(Easing.cubic)
const HALF_SCREEN_CLOSE_EASING = Easing.out(Easing.quad)
const HALF_SCREEN_DRAG_DISMISS_DISTANCE = 96
const HALF_SCREEN_DRAG_REGION_HEIGHT = 84

type AnimationPhase = "closed" | "closing" | "open" | "opening"

export type XGUIHalfScreenDialogProps = {
  children: ReactNode
  closeButtonPosition?: "left" | "right"
  contentStyle?: StyleProp<ViewStyle>
  dismissible?: boolean
  footer?: ReactNode
  headerAction?: ReactNode
  headerLeading?: ReactNode
  onAnimationComplete?: (open: boolean) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  title: string
}

export function XGUIHalfScreenDialog({
  children,
  closeButtonPosition = "right",
  contentStyle,
  dismissible = true,
  footer,
  headerAction,
  headerLeading,
  onAnimationComplete,
  onOpenChange,
  open,
  title,
}: XGUIHalfScreenDialogProps) {
  const { colors } = useXGUITheme()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const panelHeight = Math.round(windowHeight * HALF_SCREEN_HEIGHT_RATIO)
  const [presentation, setPresentation] = useState(() => ({
    keyboardReady: !open || !Keyboard.isVisible(),
    open,
  }))
  const presentationOpen =
    open && presentation.open === open && presentation.keyboardReady
  const [rendered, setRendered] = useState(presentationOpen)
  const [backdropOpacity] = useState(() => new Animated.Value(0))
  const [panelTranslateY] = useState(() => new Animated.Value(panelHeight))
  const animationRef = useRef<Animated.CompositeAnimation | null>(null)
  const animationPhaseRef = useRef<AnimationPhase>("closed")
  const animationCompleteRef = useRef(onAnimationComplete)
  const closeRequestedRef = useRef(false)

  if (presentation.open !== open) {
    setPresentation({
      keyboardReady: !open || !Keyboard.isVisible(),
      open,
    })
  }
  if (presentationOpen && !rendered) setRendered(true)

  useEffect(() => {
    animationCompleteRef.current = onAnimationComplete
  }, [onAnimationComplete])

  useEffect(() => {
    if (!open) {
      Keyboard.dismiss()
      return
    }
    if (presentation.keyboardReady) return
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setPresentation((current) =>
        current.open ? { ...current, keyboardReady: true } : current
      )
    })
    Keyboard.dismiss()
    return () => hideSubscription.remove()
  }, [open, presentation.keyboardReady])

  useEffect(() => {
    if (open) closeRequestedRef.current = false
  }, [open])

  const startCloseAnimation = useCallback(() => {
    if (!rendered || animationPhaseRef.current === "closing") return

    animationPhaseRef.current = "closing"
    animationRef.current?.stop()
    const animation = Animated.parallel([
      Animated.timing(backdropOpacity, {
        duration: XGUI_SHEET_CLOSE_DURATION_MS,
        easing: HALF_SCREEN_CLOSE_EASING,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(panelTranslateY, {
        duration: XGUI_SHEET_CLOSE_DURATION_MS,
        easing: HALF_SCREEN_CLOSE_EASING,
        toValue: panelHeight,
        useNativeDriver: true,
      }),
    ])
    animationRef.current = animation
    animation.start(({ finished }) => {
      if (!finished || animationPhaseRef.current !== "closing") return
      animationPhaseRef.current = "closed"
      setRendered(false)
      animationCompleteRef.current?.(false)
    })
  }, [backdropOpacity, panelHeight, panelTranslateY, rendered])

  const requestClose = useCallback(() => {
    if (!dismissible || closeRequestedRef.current) return
    closeRequestedRef.current = true
    startCloseAnimation()
    onOpenChange(false)
  }, [dismissible, onOpenChange, startCloseAnimation])

  useEffect(() => {
    if (!open) return
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        requestClose()
        return true
      }
    )
    return () => subscription.remove()
  }, [open, requestClose])

  const restorePanelPosition = useCallback(() => {
    Animated.spring(panelTranslateY, {
      ...XGUI_SHEET_SPRING_CONFIG,
      toValue: 0,
      useNativeDriver: true,
    }).start()
  }, [panelTranslateY])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          dismissible &&
          presentationOpen &&
          gestureState.y0 <=
            windowHeight - panelHeight + HALF_SCREEN_DRAG_REGION_HEIGHT &&
          Math.abs(gestureState.dy) > 4 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderGrant: () => {
          panelTranslateY.stopAnimation()
        },
        onPanResponderMove: (_, gestureState) => {
          panelTranslateY.setValue(
            getXGUISheetDragTranslateY(gestureState.dy)
          )
        },
        onPanResponderRelease: (_, gestureState) => {
          if (
            gestureState.dy >= HALF_SCREEN_DRAG_DISMISS_DISTANCE ||
            gestureState.vy >= 0.75
          ) {
            onOpenChange(false)
            return
          }
          restorePanelPosition()
        },
        onPanResponderTerminate: restorePanelPosition,
      }),
    [
      dismissible,
      onOpenChange,
      panelHeight,
      panelTranslateY,
      presentationOpen,
      restorePanelPosition,
      windowHeight,
    ]
  )

  useEffect(() => {
    if (presentationOpen) {
      if (!rendered) return
      if (
        animationPhaseRef.current === "open" ||
        animationPhaseRef.current === "opening"
      ) {
        return
      }

      animationPhaseRef.current = "opening"
      animationRef.current?.stop()
      panelTranslateY.setValue(panelHeight)
      backdropOpacity.setValue(0)
      const animation = Animated.parallel([
        Animated.timing(backdropOpacity, {
          duration: XGUI_SHEET_OPEN_DURATION_MS,
          easing: HALF_SCREEN_OPEN_EASING,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(panelTranslateY, {
            duration: XGUI_SHEET_OPEN_DURATION_MS,
            easing: HALF_SCREEN_OPEN_EASING,
            toValue: -8,
            useNativeDriver: true,
          }),
          Animated.spring(panelTranslateY, {
            damping: 25,
            mass: 1,
            stiffness: 550,
            toValue: 0,
            useNativeDriver: true,
          }),
        ]),
      ], { stopTogether: false })
      animationRef.current = animation
      animation.start(() => {
        if (animationPhaseRef.current !== "opening" || !open) {
          return
        }
        animationPhaseRef.current = "open"
        animationCompleteRef.current?.(true)
      })
      return
    }

    startCloseAnimation()
  }, [
    backdropOpacity,
    open,
    panelHeight,
    panelTranslateY,
    presentationOpen,
    rendered,
    startCloseAnimation,
  ])

  useEffect(
    () => () => {
      animationRef.current?.stop()
    },
    []
  )

  if (!rendered) return null

  return (
    <Portal>
      <View pointerEvents="box-none" style={styles.portal}>
        <Animated.View
          style={[styles.backdrop, { opacity: backdropOpacity }]}
        >
          <Pressable
            accessibilityLabel={`关闭${title}`}
            accessibilityRole="button"
            disabled={!dismissible}
            onPressIn={requestClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View
          {...panResponder.panHandlers}
          accessibilityViewIsModal
          style={[
            styles.frame,
            {
              backgroundColor: colors.background2,
              height: panelHeight + XGUI_SHEET_BOTTOM_OVERSCAN,
              transform: [{ translateY: panelTranslateY }],
            },
          ]}
        >
          <View style={styles.dragHandleArea}>
            <View
              style={[
                styles.dragHandle,
                { backgroundColor: colors.separator },
              ]}
            />
          </View>
          <View
            style={[
              styles.panel,
              {
                backgroundColor: colors.background2,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}
          >
            <View style={styles.header}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={[styles.title, { color: colors.textPrimary }]}
              >
                {title}
              </Text>
              {headerLeading ? (
                <View style={styles.headerLeading}>{headerLeading}</View>
              ) : (
                <Pressable
                  accessibilityLabel={`关闭${title}`}
                  accessibilityRole="button"
                  disabled={!dismissible}
                  hitSlop={8}
                  onPress={requestClose}
                  style={({ pressed }) => [
                    styles.closeButton,
                    closeButtonPosition === "left"
                      ? styles.closeButtonLeft
                      : styles.closeButtonRight,
                    pressed ? { opacity: 0.5 } : null,
                  ]}
                >
                  <X color={colors.textPrimary} size={24} strokeWidth={1.8} />
                </Pressable>
              )}
              {headerAction ? (
                <View style={styles.headerAction}>{headerAction}</View>
              ) : null}
            </View>
            <View style={[styles.content, contentStyle]}>{children}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
          <View
            pointerEvents="none"
            style={[
              styles.bottomOverscan,
              { backgroundColor: colors.background2 },
            ]}
          />
        </Animated.View>
        {!presentationOpen ? (
          <View pointerEvents="auto" style={StyleSheet.absoluteFill} />
        ) : null}
      </View>
    </Portal>
  )
}

const styles = StyleSheet.create({
  bottomOverscan: {
    height: XGUI_SHEET_BOTTOM_OVERSCAN,
  },
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.6)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  closeButton: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    position: "absolute",
    top: 8,
    width: 48,
  },
  closeButtonLeft: {
    left: 12,
  },
  closeButtonRight: {
    right: 12,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  dragHandle: {
    borderRadius: 2,
    height: 4,
    width: 36,
  },
  dragHandleArea: {
    alignItems: "center",
    height: 20,
    justifyContent: "center",
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  frame: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    bottom: -XGUI_SHEET_BOTTOM_OVERSCAN,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
  },
  header: {
    alignItems: "center",
    height: 64,
    justifyContent: "center",
    paddingHorizontal: 64,
  },
  headerAction: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    position: "absolute",
    right: 12,
    top: 8,
  },
  headerLeading: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    left: 12,
    position: "absolute",
    top: 8,
  },
  panel: {
    flex: 1,
  },
  portal: {
    bottom: 0,
    elevation: 1000,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 100000,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 24,
    textAlign: "center",
  },
})
