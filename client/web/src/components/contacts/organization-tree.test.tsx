import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { OrganizationTree } from "./organization-tree"

const snapshot = {
  units: [
    { id: "g", parent_id: null, name: "集团", kind: "group" as const },
    { id: "s", parent_id: "g", name: "子公司", kind: "subsidiary" as const },
  ],
  departments: [
    {
      id: "r",
      unit_id: "g",
      parent_id: null,
      name: "",
      is_root: true,
      leaders: [],
    },
    {
      id: "p",
      unit_id: "g",
      parent_id: "r",
      name: "技术中心",
      is_root: false,
      leaders: [],
    },
    {
      id: "c",
      unit_id: "g",
      parent_id: "p",
      name: "研发部",
      is_root: false,
      leaders: [],
    },
    {
      id: "sr",
      unit_id: "s",
      parent_id: null,
      name: "",
      is_root: true,
      leaders: [],
    },
  ],
}
it("uses one row to select and expand a unit or collapse its descendants", async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(
    <OrganizationTree
      snapshot={snapshot}
      selectedDepartmentId={null}
      onSelect={onSelect}
    />
  )
  const unit = screen.getByRole("button", { name: "子公司" })
  expect(unit).toHaveAttribute("aria-expanded", "false")
  expect(screen.getByRole("button", { name: "集团" })).toHaveAttribute(
    "aria-expanded",
    "true"
  )
  expect(screen.getByRole("button", { name: "技术中心" })).toHaveAttribute(
    "aria-expanded",
    "false"
  )
  expect(
    screen.queryByRole("button", { name: "研发部" })
  ).not.toBeInTheDocument()
  await user.click(unit)
  expect(unit).toHaveAttribute("aria-expanded", "true")
  expect(onSelect).toHaveBeenLastCalledWith("sr")
  await user.click(screen.getByRole("button", { name: "集团" }))
  expect(
    screen.queryByRole("button", { name: "子公司" })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "研发部" })
  ).not.toBeInTheDocument()
})
it("filters the tree while keeping ancestors", () => {
  render(
    <OrganizationTree
      snapshot={snapshot}
      selectedDepartmentId="c"
      onSelect={() => {}}
      keyword="研发"
    />
  )
  expect(screen.getByRole("button", { name: "集团" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "技术中心" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "研发部" })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  expect(screen.getByRole("button", { name: "研发部" })).not.toHaveClass(
    "bg-accent"
  )
  expect(
    screen.queryByRole("button", { name: "子公司" })
  ).not.toBeInTheDocument()
})

it("nests members under the selected department and allows collapse and reopening", async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(
    <OrganizationTree
      snapshot={snapshot}
      selectedDepartmentId="c"
      onSelect={onSelect}
      membersContent={() => <button type="button">成员张三</button>}
    />
  )
  expect(
    screen.getByRole("button", { name: "成员张三" }).closest("nav")
  ).not.toBeNull()
  await user.click(screen.getByRole("button", { name: "研发部" }))
  expect(
    screen.queryByRole("button", { name: "成员张三" })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "研发部" }))
  expect(screen.getByRole("button", { name: "成员张三" })).toBeInTheDocument()
  expect(onSelect).toHaveBeenCalledWith("c")
})
