import { Toast, ToastViewport, useToastState } from "tamagui"
import { useSafeAreaInsets } from "react-native-safe-area-context"

export type AppToastTone = "error" | "success"

export function CurrentAppToast() {
  const toast = useToastState()

  if (!toast || toast.isHandledNatively) return null

  const tone: AppToastTone = toast.tone === "error" ? "error" : "success"

  return (
    <Toast
      duration={toast.duration}
      key={toast.id}
      maxW={440}
      theme={tone === "error" ? "red" : "teal"}
      type="foreground"
      viewportName={toast.viewportName}
      width="90%"
    >
      <Toast.Title size="$3">{toast.title}</Toast.Title>
      {toast.message ? (
        <Toast.Description>{toast.message}</Toast.Description>
      ) : null}
    </Toast>
  )
}

export function AppToastViewport() {
  const { left, right, top } = useSafeAreaInsets()

  return (
    <ToastViewport
      flexDirection="column-reverse"
      left={left}
      right={right}
      top={top}
    />
  )
}
