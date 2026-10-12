import { Text } from "@/components/mi-sans-text"
import { useXGUITheme } from "@/xgui"

export function InlineError({ message }: { message?: string }) {
  const { colors } = useXGUITheme()
  if (!message) return null

  return (
    <Text
      style={{
        color: colors.destructive,
        fontSize: 13,
        lineHeight: 20,
        paddingBottom: 7,
        paddingHorizontal: 18,
      }}
    >
      {message}
    </Text>
  )
}
