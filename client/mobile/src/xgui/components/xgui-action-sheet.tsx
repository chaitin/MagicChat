import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
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
const ACTION_SHEET_OPEN_EASING = Easing.out(Easing.cubic)
const ACTION_SHEET_CLOSE_EASING = Easing.out(Easing.quad)
const ACTION_SHEET_DRAG_DISMISS_DISTANCE = 72

export type XGUIActionSheetAction = {
  accessibilityLabel?: string
  closeOnPress?: boolean
  destructive?: boolean
  disabled?: boolean
  deferUntilClosed?: boolean
  label: string
  onBeforePress?: () => void
  onPress: () => void
}

export type XGUIActionSheetProps = {
  actions: readonly XGUIActionSheetAction[]
  cancelDisabled?: boolean
  cancelDestructive?: boolean
  cancelLabel?: string
  children?: ReactNode
  description?: string
  descriptionNumberOfLines?: number
  maxContentHeight?: number
  onAnimationComplete?: (open: boolean) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  title?: string
  titleNumberOfLines?: number
}

type AnimationPhase = "closed" | "closing" | "open" | "opening"

export function XGUIActionSheet({
  actions,
  cancelDisabled = false,
  cancelDestructive = false,
  cancelLabel = "取消",
  children,
  description,
  descriptionNumberOfLines,
  maxContentHeight,
  onAnimationComplete,
  onOpenChange,
  open,
  title,
  titleNumberOfLines,
}: XGUIActionSheetProps) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const { colors } = useXGUITheme()
  const [panelHeight, setPanelHeight] = useState(0)
  const [backdropOpacity] = useState(() => new Animated.Value(0))
  const [panelTranslateY] = useState(() => new Animated.Value(windowHeight))
  const animationRef = useRef<Animated.CompositeAnimation | null>(null)
  const animationPhaseRef = useRef<AnimationPhase>("closed")
  const animationCompleteRef = useRef(onAnimationComplete)
  const actionLockedRef = useRef(false)
  const closeRequestedRef = useRef(false)
  const pendingActionRef = useRef<(() => void) | null>(null)
  const keyboardVisible = useSyncExternalStore(
    subscribeToKeyboardVisibility,
    () => Keyboard.isVisible(),
    () => false
  )
  const presentationOpen = open && !keyboardVisible
  const [rendered, setRendered] = useState(presentationOpen)
  const presentationOpenRef = useRef(presentationOpen)

  if (presentationOpen && !rendered) setRendered(true)

  useEffect(() => {
    presentationOpenRef.current = presentationOpen
  }, [presentationOpen])

  useEffect(() => {
    animationCompleteRef.current = onAnimationComplete
  }, [onAnimationComplete])

  useEffect(() => {
    if (open && keyboardVisible) Keyboard.dismiss()
  }, [keyboardVisible, open])

  useEffect(() => {
    if (!open) return
    actionLockedRef.current = false
    closeRequestedRef.current = false
    pendingActionRef.current = null
  }, [open])

  const startCloseAnimation = useCallback(() => {
    if (!rendered || animationPhaseRef.current === "closing") return

    animationPhaseRef.current = "closing"
    animationRef.current?.stop()
    const animation = Animated.parallel([
      Animated.timing(backdropOpacity, {
        duration: XGUI_SHEET_CLOSE_DURATION_MS,
        easing: ACTION_SHEET_CLOSE_EASING,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(panelTranslateY, {
        duration: XGUI_SHEET_CLOSE_DURATION_MS,
        easing: ACTION_SHEET_CLOSE_EASING,
        toValue: panelHeight || windowHeight,
        useNativeDriver: true,
      }),
    ])
    animationRef.current = animation
    animation.start(({ finished }) => {
      if (!finished || animationPhaseRef.current !== "closing") return

      animationPhaseRef.current = "closed"
      setRendered(false)
      animationCompleteRef.current?.(false)
      if (pendingActionRef.current) {
        const pendingAction = pendingActionRef.current
        pendingActionRef.current = null
        actionLockedRef.current = false
        requestAnimationFrame(pendingAction)
      }
    })
  }, [
    backdropOpacity,
    panelHeight,
    panelTranslateY,
    rendered,
    windowHeight,
  ])

  const requestClose = useCallback(() => {
    if (cancelDisabled || closeRequestedRef.current) return
    closeRequestedRef.current = true
    startCloseAnimation()
    onOpenChange(false)
  }, [cancelDisabled, onOpenChange, startCloseAnimation])

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
        onMoveShouldSetPanResponder: (_, gestureState) =>
          !cancelDisabled &&
          presentationOpen &&
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
            gestureState.dy >= ACTION_SHEET_DRAG_DISMISS_DISTANCE ||
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
      cancelDisabled,
      onOpenChange,
      panelTranslateY,
      presentationOpen,
      restorePanelPosition,
    ]
  )

  useEffect(() => {
    if (presentationOpen) {
      if (!rendered || panelHeight <= 0) return
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
          easing: ACTION_SHEET_OPEN_EASING,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(panelTranslateY, {
            duration: XGUI_SHEET_OPEN_DURATION_MS,
            easing: ACTION_SHEET_OPEN_EASING,
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
        if (
          animationPhaseRef.current !== "opening" ||
          !presentationOpenRef.current
        ) {
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

  const handlePanelLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height
    if (nextHeight > 0) setPanelHeight(nextHeight)
  }, [])

  if (!rendered) return null

  return (
    <Portal>
      <View pointerEvents="box-none" style={styles.portal}>
        <Animated.View
          style={[styles.backdrop, { opacity: backdropOpacity }]}
        >
          <Pressable
            accessibilityLabel={cancelLabel}
            accessibilityRole="button"
            disabled={cancelDisabled}
            onPressIn={requestClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View
          accessibilityViewIsModal
          onLayout={handlePanelLayout}
          style={[
            styles.panel,
            {
              backgroundColor: colors.background0,
              transform: [{ translateY: panelTranslateY }],
            },
          ]}
        >
          <View
            {...panResponder.panHandlers}
            style={[
              styles.dragHandleArea,
              { backgroundColor: colors.background2 },
            ]}
          >
            <View
              style={[
                styles.dragHandle,
                { backgroundColor: colors.separator },
              ]}
            />
          </View>
          <View style={{ backgroundColor: colors.background2 }}>
            {title || description ? (
              <View style={styles.header}>
                {title ? (
                  <Text
                    ellipsizeMode="tail"
                    numberOfLines={titleNumberOfLines}
                    style={[styles.title, { color: colors.textSecondary }]}
                  >
                    {title}
                  </Text>
                ) : null}
                {description ? (
                  <Text
                    ellipsizeMode="tail"
                    numberOfLines={descriptionNumberOfLines}
                    style={[
                      styles.description,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {description}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {children}
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              style={
                maxContentHeight
                  ? {
                      maxHeight: Math.max(
                        0,
                        maxContentHeight -
                          (title || description ? 56 : 0) -
                          20
                      ),
                    }
                  : undefined
              }
            >
              {actions.map((action, index) => (
                <Pressable
                  accessibilityLabel={
                    action.accessibilityLabel ?? action.label
                  }
                  accessibilityRole="button"
                  accessibilityState={{ disabled: action.disabled }}
                  disabled={action.disabled}
                  key={`${action.label}-${index}`}
                  onPress={() => {
                    if (
                      actionLockedRef.current ||
                      closeRequestedRef.current
                    ) {
                      return
                    }
                    action.onBeforePress?.()
                    if (action.closeOnPress === false) {
                      action.onPress()
                      return
                    }
                    actionLockedRef.current = true
                    closeRequestedRef.current = true
                    const deferUntilClosed =
                      action.deferUntilClosed === true
                    if (deferUntilClosed) {
                      pendingActionRef.current = action.onPress
                    }
                    startCloseAnimation()
                    onOpenChange(false)
                    if (!deferUntilClosed) {
                      setTimeout(action.onPress, 0)
                    }
                  }}
                  style={({ pressed }) => [
                    styles.action,
                    index > 0 || title || description
                      ? {
                          borderTopColor: colors.separator,
                          borderTopWidth: StyleSheet.hairlineWidth,
                        }
                      : null,
                    {
                      backgroundColor: pressed
                        ? colors.background1
                        : colors.background2,
                      opacity: action.disabled ? 0.4 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.actionText,
                      {
                        color: action.destructive
                          ? colors.destructive
                          : colors.textPrimary,
                      },
                    ]}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View style={styles.menuGap} />

          <View
            style={{
              backgroundColor: colors.background2,
              paddingBottom: insets.bottom,
            }}
          >
            <Pressable
              accessibilityLabel={cancelLabel}
              accessibilityRole="button"
              accessibilityState={{ disabled: cancelDisabled }}
              disabled={cancelDisabled}
              onPress={requestClose}
              style={({ pressed }) => [
                styles.action,
                {
                  backgroundColor: pressed
                    ? colors.background1
                    : colors.background2,
                  opacity: cancelDisabled ? 0.4 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.actionText,
                  {
                    color: cancelDestructive
                      ? colors.destructive
                      : colors.textPrimary,
                  },
                ]}
              >
                {cancelLabel}
              </Text>
            </Pressable>
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

function subscribeToKeyboardVisibility(onChange: () => void) {
  const showSubscription = Keyboard.addListener("keyboardDidShow", onChange)
  const hideSubscription = Keyboard.addListener("keyboardDidHide", onChange)
  return () => {
    showSubscription.remove()
    hideSubscription.remove()
  }
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: 16,
  },
  actionText: {
    fontSize: 17,
    lineHeight: 24,
    textAlign: "center",
  },
  bottomOverscan: {
    height: XGUI_SHEET_BOTTOM_OVERSCAN,
  },
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.5)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  description: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    textAlign: "center",
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
  header: {
    alignItems: "center",
    minHeight: 56,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  menuGap: {
    height: 8,
  },
  panel: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    bottom: -XGUI_SHEET_BOTTOM_OVERSCAN,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
  },
  portal: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  title: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
})
