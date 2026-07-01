import { describe, expect, it } from "vitest"

import { getResetPasswordPendingDialogState } from "@/pages/members-page"

describe("members page reset password dialog state", () => {
  it("opens the reset password dialog in a pending state before the API returns", () => {
    const member = {
      email: "alice@example.com",
      id: "user-1",
      joinedAt: "2026-07-01",
      name: "Alice",
      status: "enabled" as const,
    }

    expect(getResetPasswordPendingDialogState(member)).toEqual({
      isPending: true,
      member,
      newPassword: "",
      open: true,
    })
  })
})
