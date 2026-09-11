import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Modal, StyleSheet, Text, View } from "react-native"
import Svg, { Path } from "react-native-svg"

import { XGUILoadingIcon } from "@/xgui/components/xgui-loading-icon"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIToastType = "error" | "loading" | "success" | "text"

export type XGUIToastOptions = {
  duration?: number
  message: string
  modal?: boolean
  type?: XGUIToastType
}

type XGUIToastState = Required<XGUIToastOptions> & { id: number }

type XGUIToastController = {
  hide: () => void
  show: (options: XGUIToastOptions) => void
}

const XGUIToastContext = createContext<XGUIToastController | null>(null)
const DEFAULT_TOAST_DURATION = 2_000

export function XGUIToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<XGUIToastState | null>(null)
  const nextId = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const hide = useCallback(() => {
    clearTimer()
    setToast(null)
  }, [clearTimer])

  const show = useCallback(
    ({ duration = DEFAULT_TOAST_DURATION, message, modal = true, type = "text" }: XGUIToastOptions) => {
      clearTimer()
      const id = ++nextId.current
      setToast({ duration, id, message, modal, type })
      if (duration > 0) {
        timer.current = setTimeout(() => {
          setToast((current) => (current?.id === id ? null : current))
          timer.current = null
        }, duration)
      }
    },
    [clearTimer]
  )

  useEffect(() => clearTimer, [clearTimer])

  const value = useMemo(() => ({ hide, show }), [hide, show])

  return (
    <XGUIToastContext.Provider value={value}>
      {children}
      <XGUIToastView onDismiss={hide} toast={toast} />
    </XGUIToastContext.Provider>
  )
}

export function useXGUIToast() {
  const controller = useContext(XGUIToastContext)
  if (!controller) {
    throw new Error("useXGUIToast must be used within XGUIToastProvider")
  }
  return controller
}

function XGUIToastView({
  onDismiss,
  toast,
}: {
  onDismiss: () => void
  toast: XGUIToastState | null
}) {
  const { colors } = useXGUITheme()
  if (!toast) return null

  const textOnly = toast.type === "text"

  const content = (
    <View
      accessibilityLiveRegion="assertive"
      pointerEvents={toast.modal ? "auto" : "none"}
      style={[styles.overlay, !toast.modal && styles.nonModalOverlay]}
    >
      <View
        accessibilityRole="alert"
        style={[
          styles.toast,
          textOnly && styles.textToast,
          { backgroundColor: colors.background4 },
        ]}
      >
        {toast.type === "success" ? (
          <WeUIToastSuccessIcon color={colors.toastForeground} />
        ) : null}
        {toast.type === "error" ? (
          <WeUIToastWarnIcon color={colors.toastForeground} />
        ) : null}
        {toast.type === "loading" ? (
          <XGUILoadingIcon color="#EDEDED" size={56} />
        ) : null}
        <Text
          style={[
            styles.content,
            !textOnly && styles.contentWithIcon,
            { color: colors.toastForeground },
          ]}
        >
          {toast.message}
        </Text>
      </View>
    </View>
  )

  if (!toast.modal) return content

  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={() => {
        if (toast.type !== "loading") onDismiss()
      }}
      statusBarTranslucent
      transparent
      visible
    >
      {content}
    </Modal>
  )
}

function WeUIToastSuccessIcon({ color }: { color: string }) {
  return (
    <Svg height={56} viewBox="0 0 24 24" width={56}>
      <Path
        d="M8.657 18.435L3 12.778l1.414-1.414 4.95 4.95L20.678 5l1.414 1.414-12.02 12.021a1 1 0 0 1-1.415 0z"
        fill={color}
        fillRule="evenodd"
      />
    </Svg>
  )
}

function WeUIToastWarnIcon({ color }: { color: string }) {
  return (
    <Svg height={56} viewBox="0 0 24 24" width={56}>
      <Path
        d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-.763-15.864.11 7.596h1.305l.11-7.596h-1.525zm.759 10.967c.512 0 .902-.383.902-.882 0-.5-.39-.882-.902-.882a.878.878 0 0 0-.896.882c0 .499.396.882.896.882z"
        fill={color}
        fillRule="evenodd"
      />
    </Svg>
  )
}

const styles = StyleSheet.create({
  content: {
    fontSize: 14,
    lineHeight: 20,
    maxWidth: "100%",
    textAlign: "center",
  },
  contentWithIcon: {
    marginTop: 16,
  },
  nonModalOverlay: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1_000,
  },
  overlay: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    transform: [{ translateY: -40 }],
  },
  textToast: {
    minHeight: 0,
    minWidth: 0,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  toast: {
    alignItems: "center",
    borderRadius: 8,
    justifyContent: "center",
    maxWidth: 320,
    minWidth: 132,
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
})
