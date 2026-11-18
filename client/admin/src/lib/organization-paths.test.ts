import { describe, expect, it } from "vitest"

import type { OrganizationSnapshot } from "@/lib/admin-organization"
import { departmentPath, unitPath } from "@/lib/organization-paths"

const organization: OrganizationSnapshot = {
  units: [
    {
      id: "group",
      parent_id: null,
      name: "集团",
      kind: "group",
      leader_user_id: null,
      sort_order: 0,
      disabled_at: null,
    },
    {
      id: "unit",
      parent_id: "group",
      name: "子公司",
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
      id: "parent",
      unit_id: "unit",
      parent_id: "root",
      name: "研发中心",
      is_root: false,
      leaders: [],
      sort_order: 0,
    },
    {
      id: "child",
      unit_id: "unit",
      parent_id: "parent",
      name: "平台部",
      is_root: false,
      leaders: [],
      sort_order: 0,
    },
  ],
}

describe("organization creation locations", () => {
  it("includes the whole unit hierarchy", () => {
    expect(unitPath("unit", organization)).toBe("集团 / 子公司")
  })

  it("shows the department hierarchy without an empty root segment", () => {
    expect(departmentPath(organization.departments[2], organization)).toBe(
      "研发中心 / 平台部"
    )
    expect(
      [
        unitPath("unit", organization),
        departmentPath(organization.departments[2], organization),
      ]
        .filter(Boolean)
        .join(" / ")
    ).toBe("集团 / 子公司 / 研发中心 / 平台部")
  })

  it("uses only the unit path when creating directly under a unit", () => {
    expect(departmentPath(organization.departments[0], organization)).toBe("")
    expect(
      [
        unitPath("unit", organization),
        departmentPath(organization.departments[0], organization),
      ]
        .filter(Boolean)
        .join(" / ")
    ).toBe("集团 / 子公司")
  })

  it("does not invent an unknown organization location", () => {
    expect(unitPath("missing", organization)).toBe("")
  })
})
