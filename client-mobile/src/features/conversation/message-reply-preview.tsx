import { X } from "lucide-react-native"
import { Paragraph, SizableText, XStack, YStack } from "tamagui"

import { CompactIconButton } from "@/components/buttons/compact-icon-button"

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
  return (
    <XStack bg="$background" gap="$2" items="center" px="$3" pt="$2">
      <YStack
        borderColor="$color8"
        borderLeftWidth={2}
        flex={1}
        minW={0}
        pl="$2"
      >
        <SizableText fontWeight="600" numberOfLines={1} size="$2">
          回复 {target.author}
        </SizableText>
        <Paragraph color="$color10" numberOfLines={2} size="$2">
          {target.summary}
        </Paragraph>
      </YStack>
      <CompactIconButton
        accessibilityLabel="取消回复"
        icon={X}
        iconSize={18}
        onPress={onClear}
        strokeWidth={1.5}
      />
    </XStack>
  )
}
