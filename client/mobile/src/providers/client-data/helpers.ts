import type { ClientContactDirectory, ClientContacts, ClientConversation, ContactApp, ContactGroup, ContactUser } from "@/core/models"

export const EMPTY_CONTACTS: ClientContacts = { apps: [], groups: [], users: [] }
export function toError(error: unknown, fallback: string) { return error instanceof Error ? error : new Error(fallback) }
export function collectContactUserIds(value?: ClientContactDirectory) {
  if (!value) return []
  return [...value.userIds, ...value.apps.flatMap((app) => app.creatorUserId ? [app.creatorUserId] : []), ...value.groups.flatMap((group) => group.avatarMembers.flatMap((member) => member.type === "user" ? [member.id] : []))]
}
export function collectConversationUserIds(values: ClientConversation[]) {
  const ids = new Set<string>()
  for (const value of values) {
    for (const member of value.members ?? []) if (member.type === "user") ids.add(member.id)
    if (value.lastMessageSender?.type === "user") ids.add(value.lastMessageSender.id)
    if (value.topic?.sourceSender.type === "user") ids.add(value.topic.sourceSender.id)
  }
  return [...ids]
}
function profile(type: "app" | "system" | "user", id: string, users: Readonly<Record<string, ContactUser>>, apps: Readonly<Record<string, ContactApp>>) {
  if (type === "user") return users[id]
  if (type === "app") { const app = apps[id]; return app ? { avatar: app.avatar, email: "", name: app.name, nickname: "", phone: "" } : undefined }
}
export function hydrateContacts(directory: ClientContactDirectory | undefined, users: Readonly<Record<string, ContactUser>>): ClientContacts {
  if (!directory) return EMPTY_CONTACTS
  const apps = Object.fromEntries(directory.apps.map((app) => [app.id, app]))
  const groups: ContactGroup[] = directory.groups.map((group) => ({ ...group, avatarMembers: group.avatarMembers.map((member) => {
    const value = profile(member.type, member.id, users, apps)
    return value ? { ...member, avatar: value.avatar, name: value.name, nickname: value.nickname } : member
  }) }))
  return { apps: directory.apps, groups, users: directory.userIds.flatMap((id) => users[id] ? [users[id]] : []) }
}
export function hydrateClientConversationUsers(value: ClientConversation, appList: ContactApp[], users: Readonly<Record<string, ContactUser>>): ClientConversation {
  const apps = Object.fromEntries(appList.map((app) => [app.id, app]))
  const members = value.members?.map((member) => { const p = profile(member.type, member.id, users, apps); return p ? { ...member, avatar: p.avatar, email: p.email, name: p.name, nickname: p.nickname, phone: p.phone } : member })
  const sender = value.lastMessageSender; const senderProfile = sender && profile(sender.type, sender.id, users, apps)
  const lastMessageSender = sender && senderProfile ? { ...sender, name: senderProfile.name, nickname: senderProfile.nickname } : sender
  const topicSender = value.topic?.sourceSender; const topicProfile = topicSender && profile(topicSender.type, topicSender.id, users, apps)
  const topic = value.topic && topicProfile ? { ...value.topic, sourceSender: { ...value.topic.sourceSender, avatar: topicProfile.avatar, name: topicProfile.name } } : value.topic
  return { ...value, lastMessageSender, members, topic }
}
