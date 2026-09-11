import {
  createPinyinSearchText,
  normalizePinyinSearchQuery,
} from "@/lib/pinyin-search"
import {
  listClientProjectMembers,
  type ClientProjectMember,
} from "@/lib/project-data-api"

export type ProjectMemberUserResolver = {
  ensureUsers: (userIds: string[]) => Promise<void>
  getUser: (userId: string) =>
    | {
        avatar: string
        email: string
        name: string
        nickname: string
      }
    | undefined
}

export async function listAllClientProjectMembers(
  projectId: string,
  resolver?: ProjectMemberUserResolver
) {
  const members: ClientProjectMember[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await listClientProjectMembers(projectId, {
      cursor,
      limit: 100,
    })
    members.push(...page.members)
    if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
      break
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  } while (cursor)

  if (!resolver) return members
  await resolver.ensureUsers(members.map((member) => member.id))
  return hydrateClientProjectMembers(
    members,
    Object.fromEntries(
      members.flatMap((member) => {
        const user = resolver.getUser(member.id)
        return user ? [[member.id, user] as const] : []
      })
    )
  )
}

export function hydrateClientProjectMembers(
  members: ClientProjectMember[],
  usersById: Readonly<
    Record<
      string,
      {
        avatar: string
        email: string
        name: string
        nickname: string
      }
    >
  >
) {
  return members.map((member) => {
    const user = usersById[member.id]
    return user
      ? {
          ...member,
          avatar: user.avatar,
          displayName: user.nickname || user.name,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
        }
      : member
  })
}

export function projectMemberMatchesQuery(
  member: ClientProjectMember,
  query: string
) {
  const normalizedQuery = normalizePinyinSearchQuery(query)
  return createPinyinSearchText([
    member.displayName,
    member.name,
    member.email,
  ]).includes(normalizedQuery)
}
