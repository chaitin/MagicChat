import { Play } from "lucide-react-native"
import { useRef } from "react"
import { Pressable, StyleSheet } from "react-native"

import { useXGUITheme } from "@/xgui"

export function MessageVideo({ onLongPress, onPress, roundedBottom }: {
  onLongPress: () => void
  onPress: () => void
  roundedBottom: boolean
}) {
  const { colors } = useXGUITheme()
  const didLongPressRef = useRef(false)
  return (
    <Pressable
      accessibilityLabel="播放视频"
      accessibilityRole="button"
      onLongPress={() => {
        didLongPressRef.current = true
        onLongPress()
      }}
      onPress={() => {
        if (didLongPressRef.current) {
          didLongPressRef.current = false
          return
        }
        onPress()
      }}
      onPressIn={() => { didLongPressRef.current = false }}
      style={[
        styles.frame,
        roundedBottom ? styles.rounded : styles.roundedTop,
        { backgroundColor: colors.background4 },
      ]}
    >
      <Play color={colors.background2} fill={colors.background2} size={28} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  frame: { alignItems: "center", aspectRatio: 16 / 9, justifyContent: "center", overflow: "hidden", width: "100%" },
  rounded: { borderRadius: 7 },
  roundedTop: { borderTopLeftRadius: 7, borderTopRightRadius: 7 },
})
