import { BlurTargetView } from "expo-blur"
import {
  createContext,
  useContext,
  useRef,
  type RefObject,
} from "react"
import { StyleSheet, type View } from "react-native"

const AppBlurTargetContext = createContext<RefObject<View | null> | null>(null)

export function AppBlurTargetProvider({
  children,
}: React.PropsWithChildren) {
  const targetRef = useRef<View>(null)

  return (
    <AppBlurTargetContext.Provider value={targetRef}>
      <BlurTargetView ref={targetRef} style={styles.fill}>
        {children}
      </BlurTargetView>
    </AppBlurTargetContext.Provider>
  )
}

export function useAppBlurTarget() {
  const target = useContext(AppBlurTargetContext)

  if (!target) {
    throw new Error("useAppBlurTarget 必须在 AppBlurTargetProvider 内使用")
  }

  return target
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
})
