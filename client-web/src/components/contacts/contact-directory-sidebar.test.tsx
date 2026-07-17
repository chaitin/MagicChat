import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ContactDirectorySidebar } from "@/components/contacts/contact-directory-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import type {
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/lib/client-data-api"
import type { ClientAppCredentials } from "@/lib/client-api/apps"

const appApiMocks = vi.hoisted(() => ({
  createClientApp: vi.fn(),
  uploadClientAppAvatar: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock("@/lib/client-api/apps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client-api/apps")>()),
  createClientApp: appApiMocks.createClientApp,
  uploadClientAppAvatar: appApiMocks.uploadClientAppAvatar,
}))

vi.mock("sonner", () => ({
  toast: toastMocks,
}))

describe("ContactDirectorySidebar", () => {
  beforeEach(() => {
    appApiMocks.createClientApp.mockReset()
    appApiMocks.uploadClientAppAvatar.mockReset()
    toastMocks.error.mockReset()
    toastMocks.success.mockReset()
  })

  it("shows the organization contacts and hides the current user's message action", async () => {
    const user = userEvent.setup()
    const contacts: ContactUser[] = [
      {
        avatar: "",
        email: "alice@example.com",
        id: "user-1",
        lastOnlineAt: null,
        name: "Alice",
        nickname: "",
        online: true,
        phone: "",
        type: "user",
      },
      {
        avatar: "",
        email: "me@example.com",
        id: "current-user",
        lastOnlineAt: null,
        name: "Me",
        nickname: "",
        online: true,
        phone: "",
        type: "user",
      },
    ]
    render(
      <SidebarProvider>
        <ContactDirectorySidebar
          activeKeyword=""
          activeSelection={{ id: "user-1", type: "user" }}
          activeTab="user"
          appGrantUsers={contacts}
          apps={[]}
          contacts={contacts}
          contactsRefreshing={false}
          currentUserId="current-user"
          groups={[]}
          organizationName="测试组织"
          onActiveTabChange={vi.fn()}
          onKeywordChange={vi.fn()}
          onRefresh={vi.fn()}
          onSelect={vi.fn()}
          onStartAppConversation={vi.fn()}
          onStartContactConversation={vi.fn()}
          onStartGroupConversation={vi.fn()}
          openingDirectoryItemKey=""
        />
      </SidebarProvider>
    )

    const organizationTrigger = screen.getByRole("button", {
      name: "测试组织",
    })
    expect(organizationTrigger).toHaveTextContent("测试组织2")
    expect(
      organizationTrigger.closest('[data-slot="collapsible"]')
    ).toHaveClass("border")
    expect(screen.getByRole("option", { name: "Alice" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "与 Alice 对话" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "与 Me 对话" })
    ).not.toBeInTheDocument()
    expectTabContentToOwnScrolling("测试组织 联系人列表")
    expect(organizationTrigger).toHaveAttribute("aria-expanded", "true")

    await user.click(organizationTrigger)
    expect(
      screen.queryByRole("option", { name: "Alice" })
    ).not.toBeInTheDocument()
    expect(organizationTrigger).toBeInTheDocument()
  })

  it("groups joined groups and all public groups into collapsible sections", async () => {
    const user = userEvent.setup()
    const groups: ContactGroup[] = [
      createGroup("joined-group", "已加入群", true, "private"),
      createGroup("joined-public-group", "已加入公开群", true, "public"),
      createGroup("public-group", "公开群", false, "public"),
      createGroup("private-group", "未加入私有群", false, "private"),
    ]

    render(
      <SidebarProvider>
        <ContactDirectorySidebar
          activeKeyword=""
          activeSelection={null}
          activeTab="group"
          appGrantUsers={[]}
          apps={[]}
          contacts={[]}
          contactsRefreshing={false}
          currentUserId="current-user"
          groups={groups}
          organizationName="测试组织"
          onActiveTabChange={vi.fn()}
          onKeywordChange={vi.fn()}
          onRefresh={vi.fn()}
          onSelect={vi.fn()}
          onStartAppConversation={vi.fn()}
          onStartContactConversation={vi.fn()}
          onStartGroupConversation={vi.fn()}
          openingDirectoryItemKey=""
        />
      </SidebarProvider>
    )

    const joinedTrigger = screen.getByRole("button", { name: "我加入的" })
    const publicTrigger = screen.getByRole("button", { name: "公开群组" })
    expect(joinedTrigger).toHaveTextContent("我加入的2")
    expect(publicTrigger).toHaveTextContent("公开群组2")
    expect(joinedTrigger).toHaveAttribute("aria-expanded", "true")
    expect(publicTrigger).toHaveAttribute("aria-expanded", "true")
    const joinedGroupItem = screen.getByRole("option", { name: "已加入群" })
    expect(joinedGroupItem).toBeInTheDocument()
    expect(joinedGroupItem.querySelectorAll("img")).toHaveLength(2)
    expect(
      screen.getAllByRole("option", { name: "已加入公开群" })
    ).toHaveLength(2)
    expect(screen.getByRole("option", { name: "公开群" })).toBeInTheDocument()
    expect(
      screen.queryByRole("option", { name: "未加入私有群" })
    ).not.toBeInTheDocument()
    expectTabContentToOwnScrolling("我加入的群组列表")

    await user.click(joinedTrigger)
    expect(
      screen.queryByRole("option", { name: "已加入群" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("option", { name: "已加入公开群" })
    ).toBeInTheDocument()
  })

  it("groups applications by creator", () => {
    const apps: ContactApp[] = [
      createApp("built-in-app", "内置助手", null),
      createApp("owned-app", "我的助手", "current-user"),
      createApp("other-app", "其他助手", "other-user"),
    ]

    render(
      <SidebarProvider>
        <ContactDirectorySidebar
          {...createSidebarProps({ activeTab: "app", apps })}
        />
      </SidebarProvider>
    )

    expect(screen.getByRole("button", { name: "内置应用" })).toHaveTextContent(
      "内置应用1"
    )
    expect(screen.getByRole("button", { name: "我的应用" })).toHaveTextContent(
      "我的应用1"
    )
    expect(screen.getByRole("button", { name: "其他应用" })).toHaveTextContent(
      "其他应用1"
    )
    expect(screen.getByRole("button", { name: "创建应用" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "内置助手" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "我的助手" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "其他助手" })).toBeInTheDocument()
  })

  it("creates an application and shows its access information", async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    let resolveCreate!: (credentials: ClientAppCredentials) => void
    appApiMocks.createClientApp.mockReturnValueOnce(
      new Promise<ClientAppCredentials>((resolve) => {
        resolveCreate = resolve
      })
    )
    const grantableUser: ContactUser = {
      avatar: "",
      email: "alice@example.com",
      id: "user-1",
      lastOnlineAt: null,
      name: "Alice",
      nickname: "",
      online: true,
      phone: "",
      type: "user",
    }

    render(
      <SidebarProvider>
        <ContactDirectorySidebar
          {...createSidebarProps({
            activeTab: "app",
            appGrantUsers: [grantableUser],
            apps: [createApp("owned-app", "我的助手", "current-user")],
            onRefresh,
          })}
        />
      </SidebarProvider>
    )

    await user.click(screen.getByRole("button", { name: "创建应用" }))
    const dialog = screen.getByRole("dialog")
    const nameInput = within(dialog).getByLabelText("应用名称")
    const descriptionInput = within(dialog).getByLabelText("应用描述")
    const submitButton = within(dialog).getByRole("button", {
      name: "创建应用",
    })

    expect(
      within(dialog).getByRole("button", { name: "上传应用头像" })
    ).toBeInTheDocument()
    expect(submitButton).toBeDisabled()
    expect(
      within(dialog).getByRole("radio", { name: "仅我自己" })
    ).toBeChecked()
    expect(
      within(dialog).queryByLabelText("选择可访问用户")
    ).not.toBeInTheDocument()

    await user.type(nameInput, "知识库助手")
    await user.type(descriptionInput, "帮助团队查询内部知识")

    expect(nameInput).toHaveValue("知识库助手")
    expect(descriptionInput).toHaveValue("帮助团队查询内部知识")
    expect(submitButton).toBeEnabled()

    await user.click(within(dialog).getByRole("radio", { name: "部分用户" }))
    const userInput = within(dialog).getByLabelText("选择可访问用户")
    expect(userInput).toBeInTheDocument()
    expect(submitButton).toBeDisabled()

    await user.click(userInput)
    await user.click(screen.getByRole("option", { name: /Alice/ }))
    expect(within(dialog).getByText("已选择 1 名用户")).toBeInTheDocument()
    expect(submitButton).toBeEnabled()

    await user.click(submitButton)
    expect(submitButton).toBeDisabled()
    expect(within(submitButton).getByRole("status")).toBeInTheDocument()
    expect(appApiMocks.createClientApp).toHaveBeenCalledWith({
      description: "帮助团队查询内部知识",
      name: "知识库助手",
      userIds: ["user-1"],
      visibility: "restricted",
    })

    resolveCreate(createCredentials())

    const credentialsDialog = await screen.findByRole("dialog", {
      name: "应用接入信息",
    })
    expect(within(credentialsDialog).getByLabelText("连接密钥")).toHaveValue(
      "app-secret"
    )
    expect(
      (
        within(credentialsDialog).getByLabelText(
          "WebSocket 地址"
        ) as HTMLInputElement
      ).value
    ).toMatch(/\/api\/app\/ws$/)
    expect(
      screen.queryByRole("dialog", { name: "创建应用" })
    ).not.toBeInTheDocument()
    expect(toastMocks.success).toHaveBeenCalledWith("应用创建成功")
    expect(onRefresh).toHaveBeenCalledOnce()

    await user.click(
      within(credentialsDialog).getByRole("button", { name: "关闭" })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps the create application dialog open when creation fails", async () => {
    const user = userEvent.setup()
    appApiMocks.createClientApp.mockRejectedValueOnce(
      new Error("每个用户最多创建 20 个应用")
    )

    render(
      <SidebarProvider>
        <ContactDirectorySidebar
          {...createSidebarProps({
            activeTab: "app",
            apps: [createApp("owned-app", "我的助手", "current-user")],
          })}
        />
      </SidebarProvider>
    )

    await user.click(screen.getByRole("button", { name: "创建应用" }))
    const dialog = screen.getByRole("dialog", { name: "创建应用" })
    await user.type(within(dialog).getByLabelText("应用名称"), "失败的应用")
    const submitButton = within(dialog).getByRole("button", {
      name: "创建应用",
    })

    await user.click(submitButton)

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        "每个用户最多创建 20 个应用"
      )
    )
    expect(dialog).toBeInTheDocument()
    expect(submitButton).toBeEnabled()
    expect(
      screen.queryByRole("dialog", { name: "应用接入信息" })
    ).not.toBeInTheDocument()
  })

  it("preserves the section state while search forces matching contacts open", async () => {
    const user = userEvent.setup()
    const props = createSidebarProps({
      contacts: [
        {
          avatar: "",
          email: "alice@example.com",
          id: "user-1",
          lastOnlineAt: null,
          name: "Alice",
          nickname: "",
          online: true,
          phone: "",
          type: "user",
        },
      ],
    })
    const view = render(
      <SidebarProvider>
        <ContactDirectorySidebar {...props} />
      </SidebarProvider>
    )
    const organizationTrigger = screen.getByRole("button", {
      name: "测试组织",
    })

    view.rerender(
      <SidebarProvider>
        <ContactDirectorySidebar {...props} activeKeyword="alice" />
      </SidebarProvider>
    )
    await user.click(organizationTrigger)
    expect(organizationTrigger).toHaveAttribute("aria-expanded", "true")

    view.rerender(
      <SidebarProvider>
        <ContactDirectorySidebar {...props} activeKeyword="" />
      </SidebarProvider>
    )
    expect(organizationTrigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("option", { name: "Alice" })).toBeInTheDocument()
  })
})

function createSidebarProps(
  overrides: Partial<ComponentProps<typeof ContactDirectorySidebar>> = {}
): ComponentProps<typeof ContactDirectorySidebar> {
  return {
    activeKeyword: "",
    activeSelection: null,
    activeTab: "user",
    appGrantUsers: [],
    apps: [],
    contacts: [],
    contactsRefreshing: false,
    currentUserId: "current-user",
    groups: [],
    organizationName: "测试组织",
    onActiveTabChange: vi.fn(),
    onKeywordChange: vi.fn(),
    onRefresh: vi.fn(),
    onSelect: vi.fn(),
    onStartAppConversation: vi.fn(),
    onStartContactConversation: vi.fn(),
    onStartGroupConversation: vi.fn(),
    openingDirectoryItemKey: "",
    ...overrides,
  }
}

function createGroup(
  id: string,
  name: string,
  joined: boolean,
  visibility: ContactGroup["visibility"]
): ContactGroup {
  return {
    avatar: "",
    avatarMembers: joined
      ? [
          {
            avatar: "/alice.webp",
            name: "Alice",
            nickname: "",
            role: "owner",
          },
          {
            avatar: "/bob.webp",
            name: "Bob",
            nickname: "",
            role: "member",
          },
        ]
      : [],
    id,
    joined,
    memberCount: 1,
    name,
    type: "group",
    visibility,
  }
}

function createApp(
  id: string,
  name: string,
  creatorUserId: string | null
): ContactApp {
  return {
    avatar: "",
    creatorUserId,
    description: "",
    id,
    name,
    online: false,
    type: "app",
  }
}

function createCredentials(): ClientAppCredentials {
  return {
    app: {
      avatar: "",
      connectionStatus: "offline",
      createdAt: "2026-07-17T07:00:00Z",
      description: "帮助团队查询内部知识",
      enabled: true,
      id: "created-app",
      name: "知识库助手",
      updatedAt: "2026-07-17T07:00:00Z",
      userIds: ["user-1"],
      visibility: "restricted",
    },
    connectionSecret: "app-secret",
  }
}

function expectTabContentToOwnScrolling(ariaLabel: string) {
  const list = screen.getByRole("listbox", { name: ariaLabel })
  const tabsContent = list.closest('[data-slot="tabs-content"]')

  expect(tabsContent).toHaveClass(
    "no-scrollbar",
    "min-h-0",
    "flex-1",
    "overflow-x-hidden",
    "overflow-y-auto",
    "pb-3"
  )
  expect(
    tabsContent?.querySelector('[data-slot="sidebar-content"]') ?? null
  ).not.toBeInTheDocument()
}
