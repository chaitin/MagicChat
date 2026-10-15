import { useContext, type ReactNode } from "react"
import { StyleSheet, View, type TextStyle } from "react-native"

import { Text } from "@/components/mi-sans-text"
import { RealtimeContext } from "@/realtime/realtime-context"
import { XGUILoadingIcon } from "@/xgui/components/xgui-loading-icon"

export function ConnectionTitle({
  children,
  color,
  fontSize = 16,
  fontWeight,
  lineHeight,
}: {
  children?: ReactNode
  color: string
  fontSize?: number
  fontWeight?: TextStyle["fontWeight"]
  lineHeight?: number
}) {
  const realtime = useContext(RealtimeContext)
  if (!realtime?.isRecovering) return children

  return (
    <View
      accessible
      accessibilityLabel="正在加载"
      accessibilityLiveRegion="polite"
      accessibilityRole="header"
      accessibilityState={{ busy: true }}
      style={styles.row}
    >
      <XGUILoadingIcon color={color} size={16} />
      <Text numberOfLines={1} style={{ color, flexShrink: 1, fontSize, fontWeight, lineHeight: lineHeight ?? Math.max(24, fontSize + 4) }}>
        正在加载
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", gap: 7, justifyContent: "center", minWidth: 0 },
})
