import { describe, expect, it } from "vitest"
import {
  buildOrganizationMemberships,
  formatOrganizationMembership,
} from "../../../shared/organization-memberships"

const snapshot = {
  units: [
    { id: "a", name: "A子公司" },
    { id: "b", name: "B子公司" },
  ],
  departments: [
    { id: "ar", unit_id: "a", parent_id: null, name: "A子公司", is_root: true },
    { id: "br", unit_id: "b", parent_id: null, name: "B子公司", is_root: true },
    {
      id: "bp",
      unit_id: "b",
      parent_id: "br",
      name: "技术中心",
      is_root: false,
    },
    { id: "bd", unit_id: "b", parent_id: "bp", name: "研发部", is_root: false },
  ],
}

describe("organization membership display", () => {
  it("pairs each department with its own unit, keeping primary first without a default badge", () => {
    const result = buildOrganizationMemberships(snapshot, [
      { unit_id: "b", department_id: "bd", is_primary: false },
      { unit_id: "a", department_id: "ar", is_primary: true },
    ])
    expect(result.map(formatOrganizationMembership)).toEqual([
      "A子公司",
      "B子公司 / 技术中心 / 研发部",
    ])
  })

  it("does not expose a root node as a department", () => {
    const [result] = buildOrganizationMemberships(snapshot, [
      { unit_id: "b", department_id: "br", is_primary: true },
    ])
    expect(result.department).toBe("")
    expect(formatOrganizationMembership({ ...result, isPrimary: false })).toBe(
      "B子公司"
    )
  })

  it("omits unavailable and mismatched locations without substituting another unit", () => {
    expect(
      buildOrganizationMemberships(snapshot, [
        { unit_id: "a", department_id: "bd", is_primary: false },
        { unit_id: "missing", department_id: "ar", is_primary: true },
        { unit_id: "a", department_id: "missing", is_primary: false },
      ])
    ).toEqual([])
  })

  it("keeps units when the profile policy redacts departments", () => {
    const result = buildOrganizationMemberships(snapshot, [
      { unit_id: "b", department_id: "", is_primary: false },
      { unit_id: "a", department_id: "", is_primary: true },
    ])
    expect(result).toEqual([
      {
        unit: "A子公司",
        department: "",
        isPrimary: true,
        departmentID: "unit:a",
      },
      {
        unit: "B子公司",
        department: "",
        isPrimary: false,
        departmentID: "unit:b",
      },
    ])
  })

  it("does not mutate the supplied assignment order", () => {
    const assignments = [
      { unit_id: "b", department_id: "bd", is_primary: false },
      { unit_id: "a", department_id: "ar", is_primary: true },
    ]
    buildOrganizationMemberships(snapshot, assignments)
    expect(assignments[0].unit_id).toBe("b")
  })
})
