import type { ReactNode } from "react"
import { StyleSheet, View } from "react-native"

import { Text } from "@/components/mi-sans-text"
import { XGUILoadingIcon, useXGUITheme } from "@/xgui"

export function ContentState({
  children,
  loading = false,
  message,
  messageColor,
  tone = "default",
}: {
  children?: ReactNode
  loading?: boolean
  message: string
  messageColor?: string
  tone?: "default" | "error"
}) {
  const { colors } = useXGUITheme()
  const resolvedMessageColor =
    messageColor ?? (tone === "error" ? colors.destructive : colors.textSecondary)

  return (
    <View style={styles.container}>
      <View
        accessibilityLiveRegion={loading ? "polite" : "none"}
        accessibilityRole={loading ? "progressbar" : undefined}
        style={styles.content}
      >
        {loading ? (
          <XGUILoadingIcon color={colors.textPlaceholder} size={20} />
        ) : null}
        <Text style={[styles.message, { color: resolvedMessageColor }]}>
          {message}
        </Text>
      </View>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flex: 1,
    gap: 18,
    justifyContent: "center",
    padding: 32,
  },
  content: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
  },
  message: {
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
  },
})
