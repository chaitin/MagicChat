import { describe, expect, it } from "vitest"

import {
  formatMemberPhone,
  getMemberActionConfirmation,
  getResetPasswordPendingDialogState,
} from "@/pages/members-page"

describe("members page reset password dialog state", () => {
  it("opens the reset password dialog in a pending state before the API returns", () => {
    const member = {
      avatar: "/assets/avatars/builtin/01.webp",
      email: "alice@example.com",
      id: "user-1",
      joinedAt: "2026-07-01",
      name: "Alice",
      nickname: "",
      phone: "",
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

describe("members page phone formatting", () => {
  it("omits +86 when displaying mainland China phone numbers", () => {
    expect(formatMemberPhone("+8613812345678")).toBe("13812345678")
    expect(formatMemberPhone("+862112345678")).toBe("2112345678")
  })

  it("keeps non +86 phone numbers unchanged", () => {
    expect(formatMemberPhone("+14155552671")).toBe("+14155552671")
  })
})

describe("members page member action confirmation", () => {
  it("returns confirmation copy for enabling a member", () => {
    expect(getMemberActionConfirmation("enable")).toEqual({
      confirmLabel: "确认启用",
      description: "启用后，该成员可以重新登录系统。",
      title: "确认启用成员",
    })
  })

  it("returns confirmation copy for disabling a member", () => {
    expect(getMemberActionConfirmation("disable")).toEqual({
      confirmLabel: "确认禁用",
      description: "禁用后，该成员将无法继续登录，已有会话也会失效。",
      title: "确认禁用成员",
    })
  })

  it("returns confirmation copy for resetting a member password", () => {
    expect(getMemberActionConfirmation("reset_password")).toEqual({
      confirmLabel: "确认重置",
      description: "重置后旧密码将失效，新密码只会显示一次。",
      title: "确认重置密码",
    })
  })
})
