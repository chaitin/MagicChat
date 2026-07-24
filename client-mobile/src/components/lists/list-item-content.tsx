import type { ReactNode } from "react"
import { SizableText, XStack, YStack } from "tamagui"

export function ListItemContent({
  meta,
  subtitle,
  subtitleLeading,
  subtitleTrailing,
  title,
}: {
  meta?: string
  subtitle: string
  subtitleLeading?: ReactNode
  subtitleTrailing?: ReactNode
  title: string
}) {
  return (
    <YStack height="$4" justify="center" minW={0} pl="$1.5" width="100%">
      <XStack gap="$2" items="center" maxW="100%">
        <SizableText
          color="$color"
          flex={1}
          fontWeight="500"
          numberOfLines={1}
          size="$4"
        >
          {title}
        </SizableText>
        {meta ? (
          <SizableText color="$gray10" size="$2">
            {meta}
          </SizableText>
        ) : null}
      </XStack>

      <XStack gap="$1" items="center" maxW="100%">
        {subtitleLeading}
        <SizableText
          color="$gray10"
          flex={1}
          numberOfLines={1}
          size="$2"
        >
          {subtitle}
        </SizableText>
        {subtitleTrailing}
      </XStack>
    </YStack>
  )
}
