import { useEffect } from "react"
import { BackHandler } from "react-native"

export function useSheetBackHandler({
  disabled = false,
  onDismiss,
  open,
}: {
  disabled?: boolean
  onDismiss: () => void
  open: boolean
}) {
  useEffect(() => {
    if (!open) return

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!disabled) onDismiss()
        return true
      }
    )
    return () => subscription.remove()
  }, [disabled, onDismiss, open])
}
