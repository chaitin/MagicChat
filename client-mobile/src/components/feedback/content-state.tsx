import type { ReactNode } from "react"
import { Paragraph, Spinner, Theme, XStack, YStack } from "tamagui"

export function ContentState({
  children,
  loading = false,
  message,
  tone = "default",
}: {
  children?: ReactNode
  loading?: boolean
  message: string
  tone?: "default" | "error"
}) {
  const content = (
    <XStack gap="$2" items="center" justify="center">
      {loading ? <Spinner size="small" /> : null}
      <Paragraph color="$color10" text="center">
        {message}
      </Paragraph>
    </XStack>
  )

  return (
    <YStack flex={1} gap="$4" items="center" justify="center" p="$6">
      {tone === "error" ? <Theme name="red">{content}</Theme> : content}
      {children}
    </YStack>
  )
}
