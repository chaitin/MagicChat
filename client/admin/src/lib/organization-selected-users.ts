import type { AdminUser } from "./admin-users"

export function retainSelectedUsers(
  users: AdminUser[],
  ids: string[]
): AdminUser[] {
  const byID = new Map(users.map((user) => [user.id, user]))
  for (const id of ids.filter(Boolean)) {
    if (!byID.has(id))
      byID.set(id, {
        id,
        name: "成员资料未加载（" + id + "）",
        email: "",
        phone: "",
        nickname: "",
        jobTitle: "",
        avatar: "",
        createdAt: "",
        lastOnlineAt: "",
        online: false,
        status: "active",
      })
  }
  return [...byID.values()]
}
