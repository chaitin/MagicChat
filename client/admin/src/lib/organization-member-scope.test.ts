import { describe, expect, it, vi } from "vitest"
import type { OrganizationSnapshot } from "@/lib/admin-organization"
import { getMemberDepartmentIDs } from "@/lib/organization-member-scope"
import { listAdminUsers } from "@/lib/admin-users"
import { consolePages } from "@/lib/console-pages"

const snapshot = {
  units: [
    { id: "group", parent_id: null },
    { id: "company", parent_id: "group" },
    { id: "other", parent_id: null },
  ],
  departments: [
    { id: "root", unit_id: "group", parent_id: null, is_root: true },
    { id: "engineering", unit_id: "group", parent_id: "root", is_root: false },
    {
      id: "product",
      unit_id: "group",
      parent_id: "engineering",
      is_root: false,
    },
    { id: "company-root", unit_id: "company", parent_id: null, is_root: true },
    {
      id: "sales",
      unit_id: "company",
      parent_id: "company-root",
      is_root: false,
    },
    { id: "other-root", unit_id: "other", parent_id: null, is_root: true },
  ],
} as OrganizationSnapshot

describe("merged member management", () => {
  it("has a single stable menu entry", () => {
    expect(
      consolePages
        .filter((page) => page.path === "/members")
        .map((page) => page.label)
    ).toEqual(["成员与部门"])
    expect(consolePages.some((page) => page.path === "/organization")).toBe(
      false
    )
  })

  it("does not restrict all members to assigned accounts", () => {
    expect(getMemberDepartmentIDs(snapshot, null, true)).toBeUndefined()
  })

  it("distinguishes unit direct members from the entire subtree", () => {
    expect(
      getMemberDepartmentIDs(snapshot, { kind: "unit", id: "group" }, false)
    ).toEqual(["root"])
    expect(
      getMemberDepartmentIDs(snapshot, { kind: "unit", id: "group" }, true)
    ).toEqual(["root", "engineering", "product", "company-root", "sales"])
  })

  it("distinguishes direct department membership from descendants", () => {
    expect(
      getMemberDepartmentIDs(
        snapshot,
        { kind: "department", id: "engineering" },
        false
      )
    ).toEqual(["engineering"])
    expect(
      getMemberDepartmentIDs(
        snapshot,
        { kind: "department", id: "engineering" },
        true
      )
    ).toEqual(["engineering", "product"])
  })

  it("sends department scope with search and pagination to the server", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { users: [], total: 0 },
        }),
        { headers: { "content-type": "application/json" } }
      )
    )
    await listAdminUsers(
      {
        departmentIds: ["department-a", "department-b"],
        keyword: "张",
        page: 2,
        pageSize: 50,
      },
      fetcher
    )
    const url = new URL(fetcher.mock.calls[0][0], "http://localhost")
    expect(url.searchParams.get("department_ids")).toBe(
      "department-a,department-b"
    )
    expect(url.searchParams.get("keyword")).toBe("张")
    expect(url.searchParams.get("page")).toBe("2")
  })
})
