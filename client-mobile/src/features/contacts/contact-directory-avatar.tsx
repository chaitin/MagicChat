import { Bot } from "lucide-react-native"
import { Avatar, Circle, Text, YStack } from "tamagui"

import {
  GroupAvatar,
  type GroupAvatarMember,
} from "@/components/avatar/group-avatar"
import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import { ThemedIcon } from "@/components/icons/themed-icon"
import type { ServerTarget } from "@/data/query"
import { getContactInitial } from "@/features/contacts/contact-directory-model"

export function ContactDirectoryAvatar({
  avatar,
  members,
  name,
  online,
  server,
  type,
}: {
  avatar: string
  members?: GroupAvatarMember[]
  name: string
  online?: boolean
  server: ServerTarget
  type: "user" | "app" | "group"
}) {
  return (
    <YStack height="$4" width="$4">
      {type === "group" ? (
        <GroupAvatar
          avatar={avatar}
          members={members}
          name={name}
          server={server}
        />
      ) : (
        <Avatar rounded="$2" size="$4">
          <CachedAvatarImage avatar={avatar} server={server} />
          <Avatar.Fallback
            bg="$backgroundFocus"
            items="center"
            justify="center"
          >
            {type === "app" ? (
              <ThemedIcon icon={Bot} size={18} />
            ) : (
              <Text fontWeight="600">{getContactInitial(name)}</Text>
            )}
          </Avatar.Fallback>
        </Avatar>
      )}

      {online !== undefined ? (
        <Circle
          bg={online ? "$green9" : "$gray8"}
          borderColor="$background"
          borderWidth={2}
          b={-2}
          position="absolute"
          r={-2}
          size={11}
        />
      ) : null}
    </YStack>
  )
}
