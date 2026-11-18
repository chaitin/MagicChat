import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { ContactDetailPanel } from "./contact-detail-panels"
import { buildOrganizationMemberships } from "../../../../shared/organization-memberships"

vi.mock("@/components/send-namecard-button", () => ({
  SendNamecardButton: () => null,
}))

it("shows organization profile fields together with contact details", () => {
  render(
    <ContactDetailPanel
      contact={{
        id: "user",
        type: "user",
        name: "测试成员",
        nickname: "",
        email: "member@example.test",
        phone: "13812345678",
        avatar: "",
        online: false,
        lastOnlineAt: null,
      }}
      canStartConversation={false}
      startingConversation={false}
      onStartConversation={() => {}}
      organizationDetails={{
        memberships: buildOrganizationMemberships(
          {
            units: [{ id: "unit", name: "测试单位" }],
            departments: [
              {
                id: "dept",
                unit_id: "unit",
                parent_id: null,
                name: "研发部",
                is_root: false,
              },
            ],
          },
          [{ unit_id: "unit", department_id: "dept", is_primary: true }]
        ),
        title: "工程师",
        manager: "直属经理",
        dottedManagers: "项目经理",
      }}
    />
  )
  expect(screen.getByText("测试单位 / 研发部")).toBeInTheDocument()
  expect(screen.getByText("member@example.test")).toBeInTheDocument()
  expect(screen.getByText("邮箱")).toBeInTheDocument()
  expect(screen.getByText("手机")).toBeInTheDocument()
  expect(screen.getByText("13812345678")).toBeInTheDocument()
  expect(screen.getByText("职务")).toBeInTheDocument()
  expect(screen.getByText("工程师")).toBeInTheDocument()
  expect(screen.getByText("直属上级")).toBeInTheDocument()
  expect(screen.getByText("虚线上级")).toBeInTheDocument()
  expect(screen.getByText("直属经理")).toBeInTheDocument()
  expect(screen.getByText("项目经理")).toBeInTheDocument()
})
