import { describe, expect, it } from "vitest"

import { hydrateClientProjectMembers } from "@/lib/project-members"

describe("hydrateClientProjectMembers", () => {
  it("derives current profile fields while preserving project membership fields", () => {
    const members = [
      {
        avatar: "",
        displayName: "Old name",
        email: "old@example.com",
        id: "user-2",
        name: "Old name",
        nickname: "",
        role: "member" as const,
        sourceGroupIds: ["group-1"],
        status: "active" as const,
      },
    ]

    const hydrated = hydrateClientProjectMembers(members, {
      "user-2": {
        avatar: "/new.webp",
        email: "new@example.com",
        name: "New name",
        nickname: "New nickname",
      },
    })

    expect(hydrated).toEqual([
      {
        ...members[0],
        avatar: "/new.webp",
        displayName: "New nickname",
        email: "new@example.com",
        name: "New name",
        nickname: "New nickname",
      },
    ])
    expect(hydrated[0]?.role).toBe("member")
    expect(hydrated[0]?.sourceGroupIds).toEqual(["group-1"])
  })
})
