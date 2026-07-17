import { MessageCircle, UserPlus } from "lucide-react-native"
import { Spinner } from "tamagui"

import { AppButton } from "@/components/forms/app-button"
import { ThemedIcon } from "@/components/icons/themed-icon"
import type { EntityProfile } from "@/domain/entities/entity-profile"

export function EntityDetailAction({
  currentUserId,
  isPending,
  onPress,
  profile,
}: {
  currentUserId: string | null
  isPending: boolean
  onPress: () => void
  profile: EntityProfile
}) {
  if (profile.type === "user" && profile.id === currentUserId) {
    return null
  }

  const joiningGroup = profile.type === "group" && !profile.joined

  return (
    <AppButton
      accessibilityLabel={joiningGroup ? "加入群聊" : "发消息"}
      disabled={isPending}
      icon={
        isPending ? (
          <Spinner />
        ) : (
          <ThemedIcon icon={joiningGroup ? UserPlus : MessageCircle} />
        )
      }
      onPress={onPress}
      size="$4"
      theme="accent"
      width="100%"
    >
      {joiningGroup ? "加入群聊" : "发消息"}
    </AppButton>
  )
}
