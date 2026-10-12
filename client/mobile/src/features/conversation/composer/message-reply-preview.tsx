// Tabler exposes per-icon runtime entry points without per-icon declarations.
// eslint-disable-next-line import/no-unresolved
import IconCircleXFilled from "@tabler/icons-react-native/IconCircleXFilled"
import { Pressable, StyleSheet, View } from "react-native"
import { Text } from "@/components/mi-sans-text"

import { useXGUITheme } from "@/xgui"

export type MessageReplyTarget = {
  author: string
  id: string
  summary: string
}

export function MessageReplyPreview({
  onClear,
  target,
}: {
  onClear: () => void
  target: MessageReplyTarget
}) {
  const { colors } = useXGUITheme()

  return (
    <View style={[styles.preview, { backgroundColor: colors.foreground5 }]}>
      <Text
        numberOfLines={1}
        style={[styles.message, { color: colors.textSecondary }]}
      >
        {target.author}： {target.summary}
      </Text>
      <Pressable
        accessibilityLabel="取消回复"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onClear}
        style={styles.clearButton}
      >
        {({ pressed }) => (
          <IconCircleXFilled
            color={pressed ? colors.textSecondary : colors.textPlaceholder}
            size={18}
          />
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  preview: {
    alignItems: "center",
    borderRadius: 5,
    flexDirection: "row",
    height: 36,
    marginBottom: 2,
    marginHorizontal: 13,
    marginTop: 7,
    paddingLeft: 7,
  },
  clearButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    marginLeft: 8,
    width: 28,
  },
  message: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
})
