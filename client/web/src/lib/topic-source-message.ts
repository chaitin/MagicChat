import type {
  ClientTopicSourceMessage,
  ClientUser,
  ContactApp,
  ContactUser,
} from "@/lib/client-data-api"

export function isTopicSourceMessageSelectable(
  message: ClientTopicSourceMessage
) {
  return (
    message.body.type !== "revoked" &&
    message.body.type !== "unsupported" &&
    message.body.type !== "system_event"
  )
}

export function getTopicSourceSenderProfile(
  sender: ClientTopicSourceMessage["sender"],
  currentUser:
    | Pick<ClientUser, "avatar" | "id" | "name" | "nickname">
    | undefined,
  usersById: Readonly<Record<string, ContactUser>>,
  appsById: ReadonlyMap<string, ContactApp>
): { avatar: string; name: string } {
  if (sender.type === "app") {
    const app = appsById.get(sender.id)
    return {
      avatar: app?.avatar.trim() || sender.avatar,
      name: app?.name.trim() || sender.name,
    }
  }

  if (currentUser && sender.id === currentUser.id) {
    return {
      avatar: currentUser.avatar || sender.avatar,
      name:
        currentUser.nickname.trim() ||
        currentUser.name.trim() ||
        sender.name,
    }
  }

  const user = usersById[sender.id]
  if (user) {
    return {
      avatar: user.avatar.trim() || sender.avatar,
      name: user.nickname.trim() || user.name.trim() || sender.name,
    }
  }

  return { avatar: sender.avatar, name: sender.name }
}
