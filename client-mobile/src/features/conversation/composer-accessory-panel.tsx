import { Camera, Images, Paperclip } from "lucide-react-native"
import { Button, ScrollView, Separator, SizableText, XStack, YStack } from "tamagui"

import { ThemedIcon } from "@/components/icons/themed-icon"

export type ComposerAccessoryMode = "attachments" | "emoji" | null

const emojiValues = [
  "😀",
  "😃",
  "😁",
  "😄",
  "😆",
  "😅",
  "🤣",
  "😂",
  "🙂",
  "🙃",
  "😉",
  "😊",
  "😇",
  "🥰",
  "😍",
  "🤩",
  "😘",
  "😋",
  "😜",
  "🤪",
  "🤗",
  "🤭",
  "🤫",
  "🤔",
  "😐",
  "🙄",
  "😬",
  "🥺",
  "😔",
  "😢",
  "😭",
  "😴",
  "😷",
  "🤒",
  "🤢",
  "🥶",
  "🤯",
  "🥳",
  "😎",
  "😡",
]

export function ComposerAccessoryPanel({
  disabled,
  mode,
  onCameraPress,
  onEmojiPress,
  onFilePress,
  onLibraryPress,
}: {
  disabled: boolean
  mode: ComposerAccessoryMode
  onCameraPress: () => void
  onEmojiPress: (emoji: string) => void
  onFilePress: () => void
  onLibraryPress: () => void
}) {
  if (!mode) return null

  return (
    <YStack bg="$gray2">
      <Separator />
      {mode === "attachments" ? (
        <XStack flexWrap="wrap" minH={132} px="$3" py="$4">
          <AccessoryAction
            disabled={disabled}
            icon={Camera}
            label="相机"
            onPress={onCameraPress}
          />
          <AccessoryAction
            disabled={disabled}
            icon={Images}
            label="相册"
            onPress={onLibraryPress}
          />
          <AccessoryAction
            disabled={disabled}
            icon={Paperclip}
            label="附件"
            onPress={onFilePress}
          />
        </XStack>
      ) : (
        <ScrollView maxH={184} showsVerticalScrollIndicator={false}>
          <XStack flexWrap="wrap" px="$3" py="$3">
            {emojiValues.map((emoji) => (
              <Button
                accessibilityLabel={`输入表情 ${emoji}`}
                chromeless
                disabled={disabled}
                height="$4"
                key={emoji}
                onPress={() => onEmojiPress(emoji)}
                p={0}
                width="12.5%"
              >
                <SizableText size="$5">{emoji}</SizableText>
              </Button>
            ))}
          </XStack>
        </ScrollView>
      )}
    </YStack>
  )
}

function AccessoryAction({
  disabled,
  icon,
  label,
  onPress,
}: {
  disabled: boolean
  icon: typeof Camera
  label: string
  onPress: () => void
}) {
  return (
    <YStack gap="$2" items="center" width="25%">
      <Button
        accessibilityLabel={label}
        bg="$background"
        disabled={disabled}
        height={64}
        icon={<ThemedIcon icon={icon} size={22} />}
        onPress={onPress}
        rounded="$5"
        theme="gray"
        width={64}
      />
      <SizableText color="$gray10" size="$2">
        {label}
      </SizableText>
    </YStack>
  )
}
