import type { ReactNode } from "react"
import { SizableText, XStack, YStack } from "tamagui"

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
    <YStack
      height={compact ? 42 : "$4"}
      justify="center"
      minW={0}
      pl="$1.5"
      width="100%"
    >
      <XStack gap="$2" items="center" maxW="100%">
        <SizableText
          color={compact ? colors.textSecondary : colors.textPrimary}
          flex={1}
          fontSize={compact ? 12 : 18}
          lineHeight={compact ? 17 : 24}
          numberOfLines={1}
        >
          {title}
        </SizableText>
        {meta ? (
          <SizableText
            color={colors.textPlaceholder}
            fontSize={12}
            lineHeight={17}
          >
            {meta}
          </SizableText>
        ) : null}
      </XStack>

      <XStack gap="$1" items="center" maxW="100%" pt={compact ? 2 : 4}>
        {subtitleLeading}
        <SizableText
          color={colors.textPlaceholder}
          flex={1}
          fontSize={compact ? 12 : 14}
          lineHeight={compact ? 17 : 20}
          numberOfLines={1}
        >
          {subtitle}
        </SizableText>
        {subtitleTrailing}
      </XStack>
    </YStack>
  )
}
