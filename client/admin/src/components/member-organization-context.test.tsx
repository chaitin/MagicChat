import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { MemberOrganizationMemberships } from "@/components/member-organization-memberships"
import type { OrganizationSnapshot } from "@/lib/admin-organization"

const organization: OrganizationSnapshot = {
  units: [
    {
      id: "unit",
      parent_id: null,
      name: "测试单位",
      kind: "subsidiary",
      leader_user_id: null,
      sort_order: 0,
      disabled_at: null,
    },
  ],
  departments: [
    {
      id: "root",
      unit_id: "unit",
      parent_id: null,
      name: "",
      is_root: true,
      leaders: [],
      sort_order: 0,
    },
    {
      id: "department",
      unit_id: "unit",
      parent_id: "root",
      name: "研发部",
      is_root: false,
      leaders: [],
      sort_order: 0,
    },
  ],
}
const assignment = {
  department_id: "department",
  is_primary: true,
  sort_order: 0,
}

describe("contextual member organization fields", () => {
  it("does not ask for either location when adding within a department", () => {
    const html = renderToStaticMarkup(
      <MemberOrganizationMemberships
        organization={organization}
        value={[assignment]}
        fixedDepartmentID="department"
        onChange={() => {}}
      />
    )
    expect(html).toContain("测试单位 / 研发部")
    expect(html).not.toContain('role="combobox"')
  })

  it("keeps department selection but not unit selection within a unit", () => {
    const html = renderToStaticMarkup(
      <MemberOrganizationMemberships
        organization={organization}
        value={[{ ...assignment, department_id: "root" }]}
        fixedUnitID="unit"
        onChange={() => {}}
      />
    )
    expect(html.match(/role="combobox"/g)).toHaveLength(1)
    expect(html).toContain('aria-label="所属部门"')
  })

  it.each([undefined, "unit"])(
    "keeps the no-department dropdown with contextual unit %s",
    (fixedUnitID) => {
      const html = renderToStaticMarkup(
        <MemberOrganizationMemberships
          organization={{
            ...organization,
            departments: [organization.departments[0]],
          }}
          value={[{ ...assignment, department_id: "root" }]}
          fixedUnitID={fixedUnitID}
          onChange={() => {}}
        />
      )
      expect(html.match(/role="combobox"/g)).toHaveLength(fixedUnitID ? 1 : 2)
      expect(html).toContain('aria-label="所属部门"')
      expect(html).toContain("无部门")
    }
  )

  it("still allows both choices without a contextual location", () => {
    const html = renderToStaticMarkup(
      <MemberOrganizationMemberships
        organization={organization}
        value={[assignment]}
        onChange={() => {}}
      />
    )
    expect(html.match(/role="combobox"/g)).toHaveLength(2)
  })

  it("keeps the contextual membership and allows additional memberships to be edited", () => {
    const html = renderToStaticMarkup(
      <MemberOrganizationMemberships
        organization={organization}
        value={[
          assignment,
          { department_id: "root", is_primary: false, sort_order: 1 },
        ]}
        fixedDepartmentID="department"
        onChange={() => {}}
      />
    )
    expect(html.match(/role="combobox"/g)).toHaveLength(2)
    expect(html).not.toContain('aria-label="移除第 1 条组织归属"')
    expect(html).toContain('aria-label="移除第 2 条组织归属"')
  })
})
