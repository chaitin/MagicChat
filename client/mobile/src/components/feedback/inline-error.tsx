import { Paragraph, Theme } from "tamagui"

export function InlineError({ message }: { message?: string }) {
  if (!message) return null

  return (
    <Theme name="red">
      <Paragraph color="$color10" pb="$2" px="$4" size="$2">
        {message}
      </Paragraph>
    </Theme>
  )
}
