import { MessageCircle, UserPlus } from "lucide-react-native"
import { Button, Spinner } from "tamagui"

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
    <Button
      disabled={isPending}
      icon={
        isPending ? (
          <Spinner />
        ) : (
          <ThemedIcon icon={joiningGroup ? UserPlus : MessageCircle} />
        )
      }
      onPress={onPress}
      size="$5"
      width="100%"
    >
      {joiningGroup ? "加入群聊" : "发消息"}
    </Button>
  )
}
