import { describe, expect, it } from "vitest"
import type { OrganizationSnapshot } from "@/lib/admin-organization"
import { getSearchedMemberDepartmentIDs } from "@/lib/organization-member-scope"

const snapshot = {
  units: [
    { id: "group", name: "集团", parent_id: null },
    { id: "east", name: "华东公司", parent_id: "group" },
    { id: "child", name: "子公司", parent_id: "east" },
  ],
  departments: [
    {
      id: "east-root",
      name: "华东公司",
      unit_id: "east",
      parent_id: null,
      is_root: true,
    },
    {
      id: "sales",
      name: "销售部",
      unit_id: "east",
      parent_id: "east-root",
      is_root: false,
    },
    {
      id: "team",
      name: "销售一组",
      unit_id: "east",
      parent_id: "sales",
      is_root: false,
    },
    {
      id: "child-root",
      name: "子公司",
      unit_id: "child",
      parent_id: null,
      is_root: true,
    },
  ],
} as OrganizationSnapshot

describe("organization search member scope", () => {
  it("includes matched units and their descendants", () => {
    expect(getSearchedMemberDepartmentIDs(snapshot, " 华东 ", true)).toEqual([
      "east-root",
      "sales",
      "team",
      "child-root",
    ])
  })
  it("limits direct scope to matched nodes", () => {
    expect(getSearchedMemberDepartmentIDs(snapshot, "华东", false)).toEqual([
      "east-root",
    ])
    expect(getSearchedMemberDepartmentIDs(snapshot, "销售部", false)).toEqual([
      "sales",
    ])
  })
  it("includes a matching department subtree without ancestor members", () => {
    expect(getSearchedMemberDepartmentIDs(snapshot, "销售部", true)).toEqual([
      "sales",
      "team",
    ])
  })
  it("deduplicates multiple matches", () => {
    expect(getSearchedMemberDepartmentIDs(snapshot, "销售", true)).toEqual([
      "sales",
      "team",
    ])
  })
  it("distinguishes no results from a cleared search", () => {
    expect(getSearchedMemberDepartmentIDs(snapshot, "不存在", true)).toEqual([])
    expect(getSearchedMemberDepartmentIDs(snapshot, " ", true)).toBeUndefined()
  })
})
