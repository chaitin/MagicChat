import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { OrganizationTree } from "./organization-tree"

afterEach(cleanup)

const snapshot = {
  units: [
    { id: "group", parent_id: null, name: "集团", kind: "group" as const, member_count: 10 },
    { id: "company", parent_id: "group", name: "子公司", kind: "subsidiary" as const, member_count: 0 },
  ],
  departments: [
    { id: "root", unit_id: "group", parent_id: null, name: "集团", is_root: true, leaders: [], member_count: 10 },
    { id: "parent", unit_id: "group", parent_id: "root", name: "研发", is_root: false, leaders: [], member_count: 5 },
    { id: "child", unit_id: "group", parent_id: "parent", name: "平台", is_root: false, leaders: [], member_count: 2 },
    { id: "legacy", unit_id: "group", parent_id: "root", name: "旧节点", is_root: false, leaders: [] },
    { id: "company-root", unit_id: "company", parent_id: null, name: "子公司", is_root: true, leaders: [], member_count: 0 },
  ],
}

it("集团、子公司和部门显示人数，缺失字段不显示伪零人数", () => {
  render(<OrganizationTree snapshot={snapshot} selectedDepartmentId="child" onSelect={() => {}} />)
  expect(screen.getByRole("button", { name: /集团.*\(10\)/ })).toBeTruthy()
  expect(screen.getByRole("button", { name: /子公司.*\(0\)/ })).toBeTruthy()
  expect(screen.getByRole("button", { name: /研发.*\(5\)/ })).toBeTruthy()
  expect(screen.getByRole("button", { name: /平台.*\(2\)/ })).toBeTruthy()
  expect(screen.getByRole("button", { name: "旧节点" }).textContent).not.toContain("(0)")
})

it("搜索只过滤节点，不改变接口返回的人数", () => {
  const { rerender } = render(<OrganizationTree snapshot={snapshot} selectedDepartmentId="child" onSelect={() => {}} />)
  rerender(<OrganizationTree snapshot={snapshot} selectedDepartmentId="child" onSelect={() => {}} keyword="平台" />)
  expect(screen.getByRole("button", { name: /集团.*\(10\)/ })).toBeTruthy()
  expect(screen.getByRole("button", { name: /研发.*\(5\)/ })).toBeTruthy()
  expect(screen.getByRole("button", { name: /平台.*\(2\)/ })).toBeTruthy()
  expect(screen.queryByRole("button", { name: /旧节点/ })).toBeNull()
})
