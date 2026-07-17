import { Send } from "lucide-react-native"
import { useState } from "react"
import { Button, Separator, Spinner, XStack, YStack } from "tamagui"

import { AppInput } from "@/components/forms/app-input"
import { ThemedIcon } from "@/components/icons/themed-icon"

export function MessageComposer({
  disabled,
  onSend,
}: {
  disabled: boolean
  onSend: (content: string) => Promise<boolean>
}) {
  const [content, setContent] = useState("")
  const canSend = content.trim().length > 0 && !disabled

  async function handleSend() {
    const message = content.trim()
    if (!message || disabled) return
    if (await onSend(message)) setContent("")
  }

  return (
    <YStack bg="$background">
      <Separator />
      <XStack gap="$2" items="center" px="$4" py="$3">
        <AppInput
          autoCapitalize="sentences"
          color="$gray12"
          disabled={disabled}
          flex={1}
          onChangeText={setContent}
          onSubmitEditing={() => void handleSend()}
          placeholder="输入消息"
          placeholderTextColor="$gray9"
          returnKeyType="send"
          size="$4"
          value={content}
        />
        <Button
          accessibilityLabel="发送消息"
          circular
          disabled={!canSend}
          icon={
            disabled ? <Spinner /> : <ThemedIcon icon={Send} size={18} />
          }
          onPress={() => void handleSend()}
          size="$4"
          theme="accent"
        />
      </XStack>
    </YStack>
  )
}
