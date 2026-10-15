import type { ReactNode } from "react"
import { StyleSheet, View } from "react-native"

import { Text } from "@/components/mi-sans-text"
import { useXGUITheme } from "@/xgui"

export function ListItemContent({
  compact = false,
  meta,
  subtitle,
  subtitleLeading,
  subtitleTrailing,
  title,
}: {
  compact?: boolean
  meta?: string
  subtitle: string
  subtitleLeading?: ReactNode
  subtitleTrailing?: ReactNode
  title: string
}) {
  const { colors } = useXGUITheme()

  return (
    <View style={[styles.container, { height: compact ? 42 : 44 }]}>
      <View style={styles.titleRow}>
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            {
              color: compact ? colors.textSecondary : colors.textPrimary,
              fontSize: compact ? 12 : 16,
              lineHeight: compact ? 17 : 24,
            },
          ]}
        >
          {title}
        </Text>
        {meta ? (
          <Text style={[styles.meta, { color: colors.textPlaceholder }]}>
            {meta}
          </Text>
        ) : null}
      </View>

      <View style={[styles.subtitleRow, { paddingTop: compact ? 2 : 4 }]}>
        {subtitleLeading}
        <Text
          numberOfLines={1}
          style={[
            styles.subtitle,
            {
              color: colors.textPlaceholder,
              fontSize: 12,
              lineHeight: compact ? 17 : 20,
            },
          ]}
        >
          {subtitle}
        </Text>
        {subtitleTrailing}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    justifyContent: "center",
    minWidth: 0,
    paddingLeft: 4,
    width: "100%",
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    maxWidth: "100%",
  },
  title: { flex: 1 },
  meta: { fontSize: 12, lineHeight: 17 },
  subtitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
    maxWidth: "100%",
  },
  subtitle: { flex: 1 },
})
