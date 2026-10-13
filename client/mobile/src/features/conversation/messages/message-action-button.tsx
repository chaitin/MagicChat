import { Pressable, View } from "react-native"

import { MessageContentIcon } from "@/features/conversation/messages/message-content-icon"
import { useXGUITheme } from "@/xgui"

export function MessageActionButton({ accessibilityLabel, kind, disabled = false, onLongPress, onPress, onPressIn, strokeWidth }: {
  accessibilityLabel: string
  kind: "download" | "open" | "loading" | "play" | "pause"
  disabled?: boolean
  onLongPress: () => void
  onPress: () => void
  onPressIn: () => void
  strokeWidth?: number
}) {
  const { colors } = useXGUITheme()
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: kind === "loading" }}
      disabled={disabled}
      onLongPress={onLongPress}
      onPress={onPress}
      onPressIn={onPressIn}
      style={{ alignItems: "center", justifyContent: "center", borderRadius: 8, height: 36, width: 36 }}
    >
      {({ pressed }) => (
        <>
          {pressed ? (
            <View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: 8, backgroundColor: colors.textPrimary, opacity: 0.05 }} />
          ) : null}
          <MessageContentIcon color={colors.textPrimary} kind={kind} size={16} strokeWidth={strokeWidth} />
        </>
      )}
    </Pressable>
  )
}
