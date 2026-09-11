import type { ReactNode } from "react"
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIProgressProps = {
  accessibilityLabel?: string
  operation?: ReactNode
  style?: StyleProp<ViewStyle>
  value: number
}

export function XGUIProgress({
  accessibilityLabel,
  operation,
  style,
  value,
}: XGUIProgressProps) {
  const { colors } = useXGUITheme()
  const normalizedValue = Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0

  return (
    <View style={[styles.root, style]}>
      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="progressbar"
        accessibilityValue={{ max: 100, min: 0, now: normalizedValue }}
        style={[styles.bar, { backgroundColor: colors.background0 }]}
      >
        <View
          style={[
            styles.innerBar,
            {
              backgroundColor: colors.brand,
              width: `${normalizedValue}%`,
            },
          ]}
        />
      </View>
      {operation ? <View style={styles.operation}>{operation}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flex: 1,
    height: 3,
  },
  innerBar: {
    height: "100%",
  },
  operation: {
    marginLeft: 15,
  },
  root: {
    alignItems: "center",
    flexDirection: "row",
  },
})
