import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { beforeEach, expect, it, vi } from "vitest"
import { ContactsPage } from "./contacts-page"

const mocks = vi.hoisted(() => ({
  organization: vi.fn(),
  members: vi.fn(),
  assignments: vi.fn(),
  listeners: new Map<string, Set<(payload: unknown) => void>>(),
  subscribe: vi.fn((event: string, handler: (payload: unknown) => void) => {
    const handlers = mocks.listeners.get(event) ?? new Set()
    handlers.add(handler)
    mocks.listeners.set(event, handlers)
    return () => {
      handlers.delete(handler)
    }
  }),
  mode: "organization",
  contacts: [
    {
      id: "a",
      type: "user",
      name: "张三",
      nickname: "",
      avatar: "",
      email: "a@example.test",
      phone: "",
      online: false,
      lastOnlineAt: null,
    },
    {
      id: "b",
      type: "user",
      name: "李四",
      nickname: "",
      avatar: "",
      email: "b@example.test",
      phone: "",
      online: false,
      lastOnlineAt: null,
    },
  ],
}))
vi.mock("@/lib/app-info-context", () => ({
  useAppInfo: () => ({ organizationName: "集团" }),
}))
vi.mock("@/lib/realtime-context", () => ({
  useRealtime: () => ({ ready: true, subscribeRealtimeEvent: mocks.subscribe }),
}))
vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => ({
    contactDirectoryMode: mocks.mode,
    me: { id: "me" },
    contacts: mocks.contacts,
    contactApps: [],
    contactGroups: [],
    incomingFriendRequests: [],
    outgoingFriendRequests: [],
    usersById: {},
    refreshContacts: vi.fn(),
    ensureUsers: vi.fn(),
  }),
  useClientUser: (id: string) => mocks.contacts.find((c) => c.id === id),
}))
vi.mock("@/components/contacts/use-contact-profile", () => ({
  useContactProfile: ({ cached }: { cached: unknown }) => cached,
}))
vi.mock("@/components/contacts/friend-management-dialog", () => ({
  FriendManagementDialog: () => null,
}))
vi.mock("@/components/contacts/app-credentials-dialog", () => ({
  AppCredentialsDialog: () => null,
}))
vi.mock("@/components/contacts/app-profile-dialog", () => ({
  AppProfileDialog: () => null,
}))
vi.mock("@/lib/client-api/organization", () => ({
  getClientOrganization: (...args: unknown[]) => mocks.organization(...args),
  getClientOrganizationMembers: (...args: unknown[]) => mocks.members(...args),
  getClientOrganizationAssignments: (...args: unknown[]) =>
    mocks.assignments(...args),
}))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.listeners.clear()
  mocks.contacts[0].nickname = ""
  mocks.contacts[0].phone = ""
  mocks.organization.mockResolvedValue({
    units: [{ id: "unit", name: "集团", kind: "group", parent_id: null }],
    departments: [
      {
        id: "root",
        unit_id: "unit",
        name: "",
        is_root: true,
        parent_id: null,
        leaders: [],
      },
      {
        id: "dept",
        unit_id: "unit",
        name: "技术部",
        is_root: false,
        parent_id: "root",
        leaders: [],
      },
      {
        id: "other",
        unit_id: "unit",
        name: "其他部",
        is_root: false,
        parent_id: "root",
        leaders: [],
      },
    ],
  })
  mocks.members.mockImplementation((id: string) =>
    Promise.resolve({
      members:
        id === "dept"
          ? [{ ...mocks.contacts[0], title: "工程师", is_primary: true }]
          : id === "root"
            ? [{ ...mocks.contacts[1], title: "", is_primary: true }]
            : [],
      total: id === "dept" || id === "root" ? 1 : 0,
      page_size: 100,
    })
  )
  mocks.assignments.mockImplementation((id: string) =>
    Promise.resolve({
      assignments: [
        {
          id: "assignment-" + id,
          user_id: id,
          unit_id: "unit",
          department_id: id === "a" ? "dept" : "root",
          title: "",
          is_primary: true,
        },
      ],
      reporting: { direct_manager_user_id: null, dotted_manager_user_ids: [] },
    })
  )
})
function renderPage() {
  render(
    <MemoryRouter initialEntries={["/contacts"]}>
      <Routes>
        <Route
          path="/contacts/:directoryType?/:directoryId?"
          element={<ContactsPage />}
        />
      </Routes>
    </MemoryRouter>
  )
}
it("retains the root employee when selecting a department and keeps profiles on the right", async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByRole("navigation", { name: "组织架构" })
  await waitFor(() => expect(mocks.members).toHaveBeenCalledWith("root", 1))
  await screen.findByRole("option", { name: "李四" })
  await user.click(screen.getByRole("button", { name: "技术部" }))
  await user.click(await screen.findByRole("option", { name: "张三" }))
  expect(screen.getByRole("option", { name: "李四" })).toBeInTheDocument()
  expect(
    screen.getByRole("option", { name: "张三" }).closest("nav")
  ).not.toBeNull()
  expect(screen.getByRole("heading", { name: "张三" })).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "返回成员列表" })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole("option", { name: "李四" }))
  expect(screen.getByRole("heading", { name: "李四" })).toBeInTheDocument()
  expect(screen.getByRole("option", { name: "张三" })).toBeInTheDocument()
  expect(mocks.members).toHaveBeenCalledWith("dept", 1)
  expect(
    mocks.members.mock.calls.filter((args) => args[0] === "root")
  ).toHaveLength(1)
})
it("keeps an earlier node request attached to that node after selecting another", async () => {
  const user = userEvent.setup()
  let finish: (value: unknown) => void = () => {}
  mocks.members.mockImplementation((id: string) =>
    id === "dept"
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve({ members: [], total: 0, page_size: 100 })
  )
  renderPage()
  await screen.findByRole("button", { name: "技术部" })
  await user.click(screen.getByRole("button", { name: "技术部" }))
  await user.click(screen.getByRole("button", { name: "其他部" }))
  finish({ members: [mocks.contacts[0]], total: 1, page_size: 100 })
  const member = await screen.findByRole("option", { name: "张三" })
  const departmentBranch = screen.getByRole("button", { name: "技术部" })
    .parentElement?.parentElement
  expect(departmentBranch?.contains(member)).toBe(true)
  expect(screen.getByRole("button", { name: "其他部" })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
})

it.each(["张三", "小张", "a@example.test", "13800138000"])(
  "searches visible members by %s and opens their profile",
  async (keyword) => {
    mocks.contacts[0].nickname = "小张"
    mocks.contacts[0].phone = "13800138000"
    const user = userEvent.setup()
    renderPage()
    const search = await screen.findByRole("searchbox", {
      name: "搜索成员",
    })
    await user.type(search, keyword)
    const results = screen.getByRole("listbox", { name: "成员搜索结果" })
    const match = within(results).getByRole("option", { name: "小张" })
    expect(within(results).getAllByRole("option")).toHaveLength(1)
    expect(
      screen.queryByRole("navigation", { name: "组织架构" })
    ).not.toBeInTheDocument()
    expect(mocks.assignments).not.toHaveBeenCalled()
    await user.click(match)
    expect(
      screen.queryByRole("navigation", { name: "组织架构" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "小张" })).toBeInTheDocument()
    await user.clear(search)
    expect(
      screen.queryByRole("listbox", { name: "成员搜索结果" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "集团" })).toBeInTheDocument()
  }
)
it.each(["organization.updated", "contact.directory.updated"])(
  "refreshes open nodes on %s without losing expansion or keeping old pages",
  async (event) => {
    const user = userEvent.setup()
    let enabled = true
    mocks.members.mockImplementation((id: string, page: number) =>
      Promise.resolve({
        members:
          id === "root"
            ? [mocks.contacts[1]]
            : id === "dept" && enabled
              ? page === 1
                ? [mocks.contacts[0]]
                : [{ ...mocks.contacts[0], id: "c", name: "王五" }]
              : [],
        total: id === "root" ? 1 : id === "dept" && enabled ? 2 : 0,
        page_size: 1,
      })
    )
    renderPage()
    await screen.findByRole("option", { name: "李四" })
    await user.click(screen.getByRole("button", { name: "技术部" }))
    await screen.findByRole("option", { name: "张三" })
    await user.click(screen.getByRole("button", { name: "加载更多成员" }))
    await screen.findByRole("option", { name: "王五" })
    await user.click(screen.getByRole("button", { name: "其他部" }))

    const notify = () =>
      act(() => {
        for (const listener of mocks.listeners.get(event) ?? [])
          listener(
            event === "contact.directory.updated"
              ? { scope: "users", revision: 1 }
              : {}
          )
      })
    if (event === "contact.directory.updated") {
      const before = mocks.organization.mock.calls.length
      act(() => {
        for (const payload of [
          { scope: "apps", revision: 1 },
          { scope: "users", revision: 0 },
          null,
        ]) {
          for (const listener of mocks.listeners.get(event) ?? [])
            listener(payload)
        }
      })
      expect(mocks.organization).toHaveBeenCalledTimes(before)
    }
    enabled = false
    notify()
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "张三" })
      ).not.toBeInTheDocument()
    )
    expect(
      screen.queryByRole("option", { name: "王五" })
    ).not.toBeInTheDocument()
    expect(
      await screen.findByRole("option", { name: "李四" })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "技术部" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    expect(screen.getByRole("button", { name: "其他部" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )

    enabled = true
    notify()
    await screen.findByRole("option", { name: "张三" })
    expect(
      screen.queryByRole("option", { name: "王五" })
    ).not.toBeInTheDocument()
    expect(
      mocks.members.mock.calls.filter(
        ([id, page]) => id === "dept" && page === 1
      )
    ).toHaveLength(3)
  }
)

it("搜索不匹配组织名称，清空后恢复原展开状态", async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByRole("button", { name: "技术部" })
  const search = screen.getByRole("searchbox", { name: "搜索成员" })
  expect(screen.getByRole("button", { name: "技术部" })).toHaveAttribute(
    "aria-expanded",
    "false"
  )
  await user.type(search, "技术")
  expect(screen.getByText("没有匹配的成员")).toBeVisible()
  expect(
    screen.queryByRole("navigation", { name: "组织架构" })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "其他部" })
  ).not.toBeInTheDocument()
  expect(screen.queryByRole("option", { name: "李四" })).not.toBeInTheDocument()
  await user.clear(search)
  expect(screen.getByRole("button", { name: "其他部" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "技术部" })).toHaveAttribute(
    "aria-expanded",
    "false"
  )
  expect(
    await screen.findByRole("option", { name: "李四" })
  ).toBeInTheDocument()
})

it("没有匹配人员时显示空态，不展示完整架构", async () => {
  const user = userEvent.setup()
  renderPage()
  const search = await screen.findByRole("searchbox", {
    name: "搜索成员",
  })
  await user.type(search, "不存在的成员")
  await waitFor(() => expect(screen.getByText("没有匹配的成员")).toBeVisible())
  expect(screen.queryByRole("button", { name: "集团" })).not.toBeInTheDocument()
  expect(screen.queryByRole("option")).not.toBeInTheDocument()
})

it("搜索只使用可见人员，不额外请求组织归属", async () => {
  const user = userEvent.setup()
  renderPage()
  const search = await screen.findByRole("searchbox", { name: "搜索成员" })
  await user.type(search, "张三")
  const results = screen.getByRole("listbox", { name: "成员搜索结果" })
  expect(within(results).getAllByRole("option")).toHaveLength(1)
  expect(within(results).getByRole("option", { name: "张三" })).toBeVisible()
  expect(mocks.assignments).not.toHaveBeenCalled()
})

it("切换关键词后立即展示对应人员，清空恢复原组织节点", async () => {
  const user = userEvent.setup()
  renderPage()
  const search = await screen.findByRole("searchbox", { name: "搜索成员" })
  await user.type(search, "张三")
  expect(screen.getByRole("option", { name: "张三" })).toBeVisible()
  await user.clear(search)
  await user.type(search, "李四")
  expect(screen.queryByRole("option", { name: "张三" })).not.toBeInTheDocument()
  expect(
    screen.queryByRole("navigation", { name: "组织架构" })
  ).not.toBeInTheDocument()
  expect(screen.getByRole("option", { name: "李四" })).toBeVisible()
  await user.clear(search)
  expect(screen.getByRole("navigation", { name: "组织架构" })).toBeVisible()
})
