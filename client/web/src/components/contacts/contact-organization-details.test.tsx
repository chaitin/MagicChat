import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { ContactDetailPanel } from "./contact-detail-panels"
import { buildOrganizationMemberships } from "../../../../shared/organization-memberships"

vi.mock("@/components/send-namecard-button", () => ({
  SendNamecardButton: () => null,
}))

it("shows paired organization memberships on separate lines with the default marked", () => {
  const memberships = buildOrganizationMemberships(
    {
      units: [
        { id: "a", name: "A子公司" },
        { id: "b", name: "B子公司" },
      ],
      departments: [
        {
          id: "root",
          unit_id: "a",
          parent_id: null,
          name: "A子公司",
          is_root: true,
        },
        {
          id: "dept",
          unit_id: "b",
          parent_id: null,
          name: "研发部",
          is_root: false,
        },
      ],
    },
    [
      { unit_id: "a", department_id: "root", is_primary: true },
      { unit_id: "b", department_id: "dept", is_primary: false },
    ]
  )
  render(
    <ContactDetailPanel
      contact={{
        id: "user",
        type: "user",
        name: "测试成员",
        nickname: "",
        email: "",
        phone: "",
        avatar: "",
        online: false,
        lastOnlineAt: null,
      }}
      canStartConversation={false}
      startingConversation={false}
      onStartConversation={() => {}}
      organizationDetails={{
        memberships,
        title: "工程师",
        manager: "",
        dottedManagers: "",
      }}
    />
  )
  expect(screen.getByText("组织")).toBeInTheDocument()
  expect(screen.getByText("A子公司")).toBeInTheDocument()
  expect(screen.queryByText(/无部门/)).not.toBeInTheDocument()
  expect(screen.queryByText(/（默认）/)).not.toBeInTheDocument()
  expect(screen.getByText("B子公司 / 研发部")).toHaveClass("whitespace-normal")
  expect(screen.queryByText("单位")).not.toBeInTheDocument()
  expect(screen.queryByText("部门")).not.toBeInTheDocument()
  expect(screen.getByText("工程师")).toBeInTheDocument()
})
