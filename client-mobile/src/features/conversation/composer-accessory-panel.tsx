import { Camera, Images, Paperclip } from "lucide-react-native"
import { Button, ScrollView, Separator, SizableText, XStack, YStack } from "tamagui"

import { ThemedIcon } from "@/components/icons/themed-icon"

export type ComposerAccessoryMode = "attachments" | "emoji" | null

const emojiItems = [
  { label: "笑哭", value: "😂" },
  { label: "笑到打滚", value: "🤣" },
  { label: "大笑", value: "😄" },
  { label: "流汗笑", value: "😅" },
  { label: "眯眼笑", value: "😆" },
  { label: "笑脸", value: "😀" },
  { label: "开心", value: "😃" },
  { label: "露齿笑", value: "😁" },
  { label: "微笑", value: "😊" },
  { label: "浅笑", value: "🙂" },
  { label: "眨眼", value: "😉" },
  { label: "喜爱", value: "🥰" },
  { label: "花痴", value: "😍" },
  { label: "飞吻", value: "😘" },
  { label: "拥抱", value: "🤗" },
  { label: "星星眼", value: "🤩" },
  { label: "坏笑", value: "😏" },
  { label: "偷笑", value: "🤭" },
  { label: "眨眼吐舌", value: "😜" },
  { label: "倒脸", value: "🙃" },
  { label: "好吃", value: "😋" },
  { label: "滑稽", value: "🤪" },
  { label: "酷", value: "😎" },
  { label: "嘘", value: "🤫" },
  { label: "思考", value: "🤔" },
  { label: "翻白眼", value: "🙄" },
  { label: "捂脸", value: "🤦" },
  { label: "摊手", value: "🤷" },
  { label: "面无表情", value: "😑" },
  { label: "尴尬", value: "😬" },
  { label: "融化", value: "🫠" },
  { label: "小丑", value: "🤡" },
  { label: "大哭", value: "😭" },
  { label: "可怜", value: "🥺" },
  { label: "忍住眼泪", value: "🥹" },
  { label: "哭", value: "😢" },
  { label: "沮丧", value: "😔" },
  { label: "含泪微笑", value: "🥲" },
  { label: "叹气", value: "😮‍💨" },
  { label: "脸红", value: "😳" },
  { label: "愤怒", value: "😡" },
  { label: "生气", value: "😤" },
  { label: "惊恐", value: "😱" },
  { label: "爆炸头", value: "🤯" },
  { label: "庆祝", value: "🥳" },
  { label: "睡觉", value: "😴" },
  { label: "打哈欠", value: "🥱" },
  { label: "敬礼", value: "🫡" },
  { label: "赞", value: "👍" },
  { label: "鼓掌", value: "👏" },
  { label: "拜托", value: "🙏" },
  { label: "好的", value: "👌" },
  { label: "加油", value: "💪" },
  { label: "胜利", value: "✌️" },
  { label: "握手", value: "🤝" },
  { label: "踩", value: "👎" },
  { label: "挥手", value: "👋" },
  { label: "关注", value: "👀" },
  { label: "爱心", value: "❤️" },
  { label: "爱心手势", value: "🫶" },
  { label: "火", value: "🔥" },
  { label: "庆祝礼花", value: "🎉" },
  { label: "完成", value: "✅" },
  { label: "错误", value: "❌" },
] as const

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
    <YStack bg="$background">
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
            {emojiItems.map((emoji) => (
              <Button
                accessibilityLabel={emoji.label}
                chromeless
                disabled={disabled}
                height="$4"
                key={emoji.value}
                onPress={() => onEmojiPress(emoji.value)}
                p={0}
                width="12.5%"
              >
                <SizableText size="$5">{emoji.value}</SizableText>
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
        bg="$color4"
        disabled={disabled}
        height={64}
        icon={<ThemedIcon icon={icon} size={22} />}
        onPress={onPress}
        rounded="$5"
        width={64}
      />
      <SizableText color="$gray10" size="$2">
        {label}
      </SizableText>
    </YStack>
  )
}
