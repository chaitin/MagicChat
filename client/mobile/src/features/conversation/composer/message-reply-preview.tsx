// Tabler exposes per-icon runtime entry points without per-icon declarations.
// eslint-disable-next-line import/no-unresolved
import IconCircleXFilled from "@tabler/icons-react-native/IconCircleXFilled"
import { Pressable, StyleSheet, Text } from "react-native"
import { XStack } from "tamagui"

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
    <XStack
      bg={colors.foreground5}
      height={36}
      items="center"
      mb="$1"
      mt="$2"
      mx="$3"
      pl="$2"
      rounded="$2"
    >
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
    </XStack>
  )
}

const styles = StyleSheet.create({
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
