import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { createRequire } from "node:module"
import { createElement, type ComponentType } from "react"
import * as React from "react"
import * as jsxRuntime from "react/jsx-runtime"
const ts = createRequire(import.meta.url)(
  "typescript"
) as typeof import("typescript")
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import * as directoryModel from "../../../shared/organization-directory"
import * as mobileNavigation from "../../../mobile/src/features/contacts/organization-directory-navigation"

const snapshot = {
  units: [{ id: "unit", parent_id: null, name: "集团", kind: "group" }],
  departments: [
    {
      id: "root",
      unit_id: "unit",
      parent_id: null,
      name: "集团",
      is_root: true,
    },
    {
      id: "dev",
      unit_id: "unit",
      parent_id: "root",
      name: "研发部",
      is_root: false,
    },
    {
      id: "sales",
      unit_id: "unit",
      parent_id: "root",
      name: "销售部",
      is_root: false,
    },
  ],
}
const user = {
  id: "member",
  name: "张三",
  nickname: "",
  email: "member@example.test",
  phone: "13800138000",
  avatar: "",
  type: "user",
  avatarType: "user",
  avatarId: "member",
  online: false,
  lastOnlineAt: null,
}
const session = { id: "server", url: "http://localhost", userId: "viewer" }
const fetchMembers = vi.fn()
const onSelect = vi.fn()
const refetch = vi.fn()
let queryVersion = 1
const icon = () => null
const colors = {
  background0: "#fff",
  background1: "#eee",
  textPrimary: "#000",
  textSecondary: "#777",
  separator: "#ddd",
}

function primitive(tag: string) {
  return ({ children }: React.PropsWithChildren) =>
    createElement(tag, null, children)
}
const nativePressable = ({
  children,
  onPress,
  accessibilityLabel,
  disabled,
}: React.PropsWithChildren<{
  onPress: () => void
  accessibilityLabel?: string
  disabled?: boolean
}>) => (
  <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
    {children}
  </button>
)

// Exercise each actual client component with platform-only boundaries replaced.
function loadClient(
  relativePath: string,
  dependencies: Record<string, unknown>
) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const exports: Record<string, ComponentType<Record<string, unknown>>> = {}
  runInNewContext(compiled, {
    exports,
    window,
    document,
    console,
    require: (id: string) => {
      if (id === "react") return React
      if (id === "react/jsx-runtime") return jsxRuntime
      if (id.endsWith("shared/organization-directory")) return directoryModel
      if (id in dependencies) return dependencies[id]
      throw new Error("未模拟的平台依赖: " + id)
    },
  })
  return exports
}

const DesktopDirectory = loadClient(
  "../../../desktop/src/renderer/features/contacts/organization-directory.tsx",
  {
    "lucide-react": { Building2: icon, ChevronRight: icon, Folder: icon },
    "@/components/avatar/entity-avatar": { EntityAvatar: icon },
    "@/lib/utils": {
      cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
    },
  }
).OrganizationDirectory

const DesktopSearchHeader = loadClient(
  "../../../desktop/src/renderer/components/sidebar-search-header.tsx",
  {
    "@hugeicons/core-free-icons": {},
    "@/components/icons/hugeicons-icon": { HugeiconsIcon: icon },
    "@/components/ui/input": {
      Input: (props: React.ComponentProps<"input">) => <input {...props} />,
    },
    "@/components/global-search-dialog": {
      GlobalSearchDialog: ({ open }: { open: boolean }) =>
        open ? <div role="dialog">全局搜索</div> : null,
    },
    "@/components/motion/button/base": {
      Button: ({
        children,
        onClick,
      }: React.PropsWithChildren<{ onClick?: () => void }>) => (
        <button onClick={onClick}>{children}</button>
      ),
    },
    "@/lib/app-shortcuts": {
      useAppShortcuts: () => ({ search: "mod+k" }),
      matchesKeyboardShortcut: (event: KeyboardEvent) => event.key === "k",
    },
    "@/components/ui/dropdown-menu": {
      DropdownMenu: primitive("div"),
      DropdownMenuContent: primitive("div"),
      DropdownMenuItem: primitive("div"),
      DropdownMenuTrigger: primitive("div"),
    },
  }
).SidebarSearchHeader

const mobileNative = {
  View: primitive("div"),
  Text: primitive("span"),
  ScrollView: primitive("div"),
  ActivityIndicator: () => <span role="status">加载中</span>,
  Pressable: nativePressable,
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
}
const mobileTheme = { useXGUITheme: () => ({ colors }) }
const MobileListItemContent = loadClient(
  "../../../mobile/src/components/lists/list-item-content.tsx",
  {
    "react-native": mobileNative,
    "@/components/mi-sans-text": { Text: mobileNative.Text },
    "@/xgui": mobileTheme,
  }
).ListItemContent
const MobileBreadcrumbs = loadClient(
  "../../../mobile/src/features/contacts/organization-directory-breadcrumbs.tsx",
  {
    "react-native": mobileNative,
    "lucide-react-native": { ChevronRight: icon },
    "@/components/mi-sans-text": { Text: mobileNative.Text },
    "@/xgui": mobileTheme,
  }
).OrganizationDirectoryBreadcrumbs

const MobileDirectory = loadClient(
  "../../../mobile/src/features/contacts/organization-directory-screen.tsx",
  {
    "@tanstack/react-query": {
      useQuery: () => ({
        data: snapshot,
        dataUpdatedAt: queryVersion,
        isPending: false,
        refetch,
      }),
    },
    "expo-router": {
      useRouter: () => ({ push: onSelect }),
      useFocusEffect: () => {},
    },
    "react-native": mobileNative,
    "lucide-react-native": {
      Building2: icon,
      ChevronRight: icon,
      Folder: icon,
    },
    "@/components/layout/keyboard-aware-screen": {
      KeyboardAwareScreen: primitive("div"),
    },
    "@/components/navigation/app-header": { AppHeader: () => null },
    "@/components/lists/list-item-content": {
      ListItemContent: MobileListItemContent,
    },
    "./organization-directory-breadcrumbs": {
      OrganizationDirectoryBreadcrumbs: MobileBreadcrumbs,
    },
    "./organization-directory-navigation": mobileNavigation,
    "@/data/contacts/organization-api": {
      fetchOrganizationSnapshot: () => snapshot,
      fetchDepartmentMembers: (...args: unknown[]) => fetchMembers(...args),
      ORGANIZATION_FALLBACK_INTERVAL_MS: 900000,
    },
    "@/domain/contacts/contact-display": {
      getContactDisplayName: (value: typeof user) =>
        value.nickname || value.name,
    },
    "@/features/contacts/contact-directory-avatar": {
      ContactDirectoryAvatar: icon,
    },
    "@/navigation/entity-details": {
      buildEntityDetailHref: (value: unknown) => value,
    },
    "@/providers/auth-provider": { useAuthenticatedSession: () => session },
    "@/providers/client-data-provider": {
      useClientContacts: () => ({ contacts: { users: [user] } }),
    },
    "@/xgui": {
      ...mobileTheme,
      XGUIFilledSearchBar: ({
        accessibilityLabel,
        onChangeText,
        value,
      }: {
        accessibilityLabel: string
        onChangeText: (value: string) => void
        value: string
      }) => (
        <input
          type="search"
          aria-label={accessibilityLabel}
          value={value}
          onChange={(event) => onChangeText(event.target.value)}
        />
      ),
    },
  }
).OrganizationDirectoryScreen

it.each(["desktop", "mobile"])(
  "%s 搜索只展示匹配人员，组织名称不产生节点结果，清空恢复架构",
  async (client) => {
    const desktop = (keyword: string) => (
      <DesktopDirectory
        snapshot={snapshot}
        contacts={[user]}
        targetId="server"
        theme="light"
        revision={0}
        keyword={keyword}
        onSelect={onSelect}
      />
    )
    const view = render(
      client === "desktop" ? desktop("") : <MobileDirectory />
    )
    expect(screen.getByRole("button", { name: "研发部" })).toBeInTheDocument()
    for (const keyword of [
      "张三",
      "MEMBER@example.test",
      "13800138000",
      "研发",
      "不存在",
    ]) {
      if (client === "desktop") view.rerender(desktop(keyword))
      else
        fireEvent.change(screen.getByRole("searchbox", { name: "搜索成员" }), {
          target: { value: keyword },
        })
      expect(
        screen.queryByRole("button", { name: "研发部" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "销售部" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("navigation", { name: "组织架构" })
      ).not.toBeInTheDocument()
      const role = client === "desktop" ? "option" : "button"
      const name = client === "desktop" ? "张三" : "查看联系人 张三"
      if (keyword === "研发" || keyword === "不存在") {
        expect(screen.queryByRole(role, { name })).not.toBeInTheDocument()
        expect(screen.getByText("没有匹配的成员")).toBeInTheDocument()
      } else {
        expect(screen.getByRole(role, { name })).toBeInTheDocument()
      }
    }
    if (client === "desktop") view.rerender(desktop(""))
    else
      fireEvent.change(screen.getByRole("searchbox", { name: "搜索成员" }), {
        target: { value: "" },
      })
    expect(screen.getByRole("button", { name: "研发部" })).toBeInTheDocument()
    expect(screen.queryByText("没有匹配的成员")).not.toBeInTheDocument()
  }
)

it("桌面通讯录搜索框直接输入人员关键词，快捷键聚焦而非打开全局搜索", () => {
  const onChange = vi.fn()
  render(
    <DesktopSearchHeader
      searchLabel="搜索成员"
      memberSearch={{ value: "", onChange }}
    />
  )
  const search = screen.getByRole("searchbox", { name: "搜索成员" })
  fireEvent.change(search, { target: { value: "张三" } })
  expect(onChange).toHaveBeenCalledWith("张三")
  fireEvent.keyDown(document, { key: "k", metaKey: true })
  expect(search).toHaveFocus()
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})

beforeEach(() => {
  vi.clearAllMocks()
  queryVersion = 1
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: {
      windowControls: { platform: "darwin" },
      accountData: {
        getOrganizationMembers: async ({
          departmentId,
          page,
        }: {
          departmentId: string
          page: number
        }) => ({
          ok: true,
          data: await fetchMembers(session, departmentId, page),
        }),
      },
    },
  })
  fetchMembers.mockImplementation(async (_session, id: string) => ({
    members: id === "dev" ? [user] : [],
    total: id === "dev" ? 2 : 0,
  }))
})

it("desktop embeds the organization children under the existing unit heading", () => {
  render(
    <DesktopDirectory
      snapshot={snapshot}
      contacts={[user]}
      targetId="server"
      theme="light"
      revision={0}
      rootUnitId="unit"
      onSelect={onSelect}
    />
  )
  const tree = screen.getByRole("navigation", { name: "组织架构" })
  expect(screen.queryByRole("button", { name: "集团" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "研发部" })).toBeInTheDocument()
  expect(tree).toContainElement(screen.getByRole("button", { name: "销售部" }))
})

it.each(["desktop", "mobile"])(
  "%s keeps loaded members while retrying the failed page",
  async (client) => {
    if (client === "desktop")
      render(
        <DesktopDirectory
          snapshot={snapshot}
          contacts={[user]}
          targetId="server"
          theme="light"
          revision={0}
          onSelect={onSelect}
        />
      )
    else render(<MobileDirectory />)
    fireEvent.click(screen.getByRole("button", { name: "研发部" }))
    const member = await screen.findByRole(
      client === "desktop" ? "option" : "button",
      { name: client === "desktop" ? "张三" : "查看联系人 张三" }
    )
    expect(member).toBeInTheDocument()
    let reject!: (reason: Error) => void
    fetchMembers.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        })
    )
    fireEvent.click(screen.getByRole("button", { name: "加载更多成员" }))
    await waitFor(() => expect(reject).toBeTypeOf("function"))
    expect(screen.getByRole("button", { name: "加载中…" })).toBeDisabled()
    await act(async () => {
      reject(new Error("网络中断"))
    })
    expect(member).toBeInTheDocument()
    fetchMembers.mockResolvedValueOnce({
      members: [{ ...user, id: "second", name: "李四" }],
      total: 2,
    })
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    await screen.findByRole(client === "desktop" ? "option" : "button", {
      name: client === "desktop" ? "李四" : "查看联系人 李四",
    })
    expect(
      fetchMembers.mock.calls
        .filter(([, id]) => id === "dev")
        .map(([, , page]) => page)
    ).toEqual([1, 2, 2])
    if (client === "mobile") {
      fireEvent.click(screen.getByRole("button", { name: "返回集团" }))
      expect(member).not.toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole("button", { name: "销售部" }))
    if (client === "desktop") {
      expect(member).toBeInTheDocument()
      expect(
        screen.queryByRole("searchbox", { name: "搜索成员" })
      ).not.toBeInTheDocument()
      expect(screen.getByRole("region", { name: "组织通讯录" })).toHaveClass(
        "bg-xgui-background-1"
      )
    } else {
      expect(await screen.findByText("当前层级暂无内容")).toBeInTheDocument()
      fireEvent.change(screen.getByRole("searchbox", { name: "搜索成员" }), {
        target: { value: "member@example.test" },
      })
      expect(screen.getByText("成员")).toBeInTheDocument()
    }
  }
)

it.each(["desktop", "mobile"])(
  "%s refreshes members without leaving the selected department",
  async (client) => {
    const desktop = (revision: number) => (
      <DesktopDirectory
        snapshot={snapshot}
        contacts={[user]}
        targetId="server"
        theme="light"
        revision={revision}
        onSelect={onSelect}
      />
    )
    const view = render(client === "desktop" ? desktop(1) : <MobileDirectory />)
    fireEvent.click(screen.getByRole("button", { name: "研发部" }))
    const role = client === "desktop" ? "option" : "button"
    const name = client === "desktop" ? "张三" : "查看联系人 张三"
    await screen.findByRole(role, { name })
    fetchMembers.mockResolvedValue({ members: [], total: 0 })
    queryVersion = 2
    view.rerender(client === "desktop" ? desktop(2) : <MobileDirectory />)
    await waitFor(() =>
      expect(screen.queryByRole(role, { name })).not.toBeInTheDocument()
    )
    expect(
      fetchMembers.mock.calls.filter(([, id]) => id === "dev")
    ).toHaveLength(2)
    expect(
      await screen.findAllByText(
        client === "desktop" ? "暂无成员" : "当前层级暂无内容"
      )
    ).not.toHaveLength(0)
    if (client === "mobile") {
      expect(
        screen.getByRole("button", { name: "返回集团" })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "销售部" })
      ).not.toBeInTheDocument()
    }
  }
)

it("desktop keeps one highlighted member while switching and expanding nodes", async () => {
  const second = { ...user, id: "second", name: "李四" }
  fetchMembers.mockImplementation(async (_session, id: string) => ({
    members: id === "dev" ? [user, second] : [],
    total: id === "dev" ? 2 : 0,
  }))
  function DirectoryWithSelection() {
    const [selected, setSelected] = React.useState<string>()
    return (
      <DesktopDirectory
        snapshot={snapshot}
        contacts={[user, second]}
        targetId="server"
        theme="light"
        revision={0}
        selectedUserId={selected}
        onSelect={(value: typeof user) => setSelected(value.id)}
      />
    )
  }
  render(<DirectoryWithSelection />)
  const department = screen.getByRole("button", { name: "研发部" })
  fireEvent.click(department)
  expect(department).toHaveAttribute("aria-expanded", "true")
  expect(department).not.toHaveAttribute("aria-pressed")
  expect(department).not.toHaveClass("bg-accent")
  const member = await screen.findByRole("option", { name: "张三" })
  expect(member).toHaveClass("hover:bg-muted/70")
  fireEvent.click(member)
  expect(member).toHaveAttribute("aria-selected", "true")
  expect(member).toHaveClass("bg-xgui-brand-1")
  const nextMember = screen.getByRole("option", { name: "李四" })
  fireEvent.click(nextMember)
  expect(member).toHaveAttribute("aria-selected", "false")
  expect(member).not.toHaveClass("bg-xgui-brand-1")
  expect(nextMember).toHaveAttribute("aria-selected", "true")
  expect(nextMember).toHaveClass("bg-xgui-brand-1")
  const other = screen.getByRole("button", { name: "销售部" })
  fireEvent.click(other)
  expect(other).toHaveAttribute("aria-expanded", "true")
  expect(other).not.toHaveAttribute("aria-pressed")
  expect(other).not.toHaveClass("bg-accent")
  expect(screen.getAllByRole("option", { selected: true })).toHaveLength(1)
  fireEvent.click(other)
  expect(other).toHaveAttribute("aria-expanded", "false")
  expect(other).not.toHaveClass("bg-accent")
  expect(nextMember).toHaveAttribute("aria-selected", "true")
})
