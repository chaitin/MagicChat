import { createContext, useContext, type ReactNode } from "react"
import {
  AnimatedToastStack,
  useAnimatedToastStack,
  type ToastInput,
} from "@/components/motion/animated-toast-stack"

const AnimatedToastContext = createContext<
  { showToast: (toast: ToastInput) => string } | undefined
>(undefined)

export function AnimatedToastProvider({ children }: { children: ReactNode }) {
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({ limit: 4 })

  return (
    <AnimatedToastContext.Provider value={{ showToast }}>
      {children}
      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} position="bottom-right" fixed />
    </AnimatedToastContext.Provider>
  )
}

export function useAnimatedToast() {
  const context = useContext(AnimatedToastContext)
  if (!context) throw new Error("useAnimatedToast 必须在 AnimatedToastProvider 内使用")
  return context
}
