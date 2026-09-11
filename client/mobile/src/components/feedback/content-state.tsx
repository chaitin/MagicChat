import type { ComponentProps, ReactNode } from "react"
import { Paragraph, XStack, YStack } from "tamagui"

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
  messageColor?: ComponentProps<typeof Paragraph>["color"]
  tone?: "default" | "error"
}) {
  const { colors } = useXGUITheme()
  const resolvedMessageColor =
    messageColor ?? (tone === "error" ? colors.destructive : colors.textSecondary)
  const content = (
    <XStack
      accessibilityLiveRegion={loading ? "polite" : "none"}
      accessibilityRole={loading ? "progressbar" : undefined}
      gap="$2"
      items="center"
      justify="center"
    >
      {loading ? (
        <XGUILoadingIcon color={colors.textPlaceholder} size={20} />
      ) : null}
      <Paragraph color={resolvedMessageColor} text="center">
        {message}
      </Paragraph>
    </XStack>
  )

  return (
    <YStack flex={1} gap="$4" items="center" justify="center" p="$6">
      {content}
      {children}
    </YStack>
  )
}
