import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { MemoryRouter, Route, Routes } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AppLayout } from "@/components/app-layout"
import { LoginPage } from "@/pages/login-page"
import { defaultAppInfo } from "@/lib/app-info"
import { AppInfoContext } from "@/lib/app-info-context"
import { configureDesktopHost } from "@/lib/desktop-host"

const mocks = vi.hoisted(() => ({
  locale: "zh-CN" as "zh-CN" | "en",
  clientData: {
    clearMessageScope: vi.fn(),
    conversations: [] as Array<{ unreadCount: number }>,
    incomingFriendRequests: [] as Array<{
      status: "accepted" | "canceled" | "pending" | "rejected"
    }>,
    me: {
      avatar: "",
      createdAt: "2026-07-09T00:00:00Z",
      email: "me@example.com",
      id: "user-1",
      lastOnlineAt: null,
      name: "张三",
      nickname: "三三",
      phone: "",
      status: "active",
    },
    refreshMe: vi.fn(),
  },
  clientLogout: vi.fn(),
  setTheme: vi.fn(),
  updateCurrentClientUser: vi.fn(),
  uploadCurrentClientAvatar: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.locale = "zh-CN"
  mocks.clientData.conversations = []
  mocks.clientData.incomingFriendRequests = []
})

vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => mocks.clientData,
}))

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    setTheme: mocks.setTheme,
    theme: "system",
  }),
}))

vi.mock("@/components/locale-provider", async () => {
  const { createElement, Fragment } = await import("react")
  const { translate } = await import("@/lib/i18n")
  return {
    LocaleProvider: ({ children }: { children: React.ReactNode }) =>
      createElement(Fragment, null, children),
    useLocale: () => ({
      fontScale: "normal",
      locale: mocks.locale,
      t: (key: string, params?: Record<string, string | number>) =>
        translate(mocks.locale, key as never, params),
    }),
  }
})

vi.mock("@/lib/client-auth", () => ({
  clientLogout: mocks.clientLogout,
}))

vi.mock("@/lib/client-data-api", () => ({
  updateCurrentClientUser: mocks.updateCurrentClientUser,
  uploadCurrentClientAvatar: mocks.uploadCurrentClientAvatar,
}))

describe("AppLayout", () => {
  it("英文导航保留完整名称，路由选中态统一使用 ghost 外观", async () => {
    mocks.locale = "en"
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>,
    )
    const chats = screen.getByRole("link", { name: "Chats" })
    const contacts = screen.getByRole("link", { name: "Contacts" })
    const projects = screen.getByRole("link", { name: "Projects" })
    for (const link of [chats, contacts, projects]) {
      expect(link).toHaveAttribute("data-variant", "ghost")
      expect(link).toHaveAttribute("title", link.textContent)
    }
    expect(chats).toHaveAttribute("aria-current", "page")
    await user.click(contacts)
    expect(contacts).toHaveAttribute("aria-current", "page")
    expect(chats).not.toHaveAttribute("aria-current")
  })

  it("保留三列布局所需的应用导航栏锚点", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>,
    )

    const appRail = screen.getByRole("complementary")
    const shell = appRail.parentElement

    expect(shell).toHaveClass("app-layout-shell")
    expect(shell).not.toHaveClass("pt-10")
    expect(appRail).toHaveClass("app-navigation-rail")
  })

  it("导航图标使用与侧栏一致的原生中文提示", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>,
    )

    expect(screen.getByRole("link", { name: "聊天" })).toHaveAttribute("title", "聊天")
    expect(screen.getByRole("link", { name: "通讯录" })).toHaveAttribute("title", "通讯录")
    expect(screen.getByRole("link", { name: "项目" })).toHaveAttribute("title", "项目")
  })

  it("左栏以更大尺寸展示头像和功能图标", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole("button", { name: "用户菜单" }).querySelector("[data-slot='avatar']"),
    ).toHaveClass("size-9")

    const leftRailControls = [
      screen.getByRole("link", { name: "聊天" }),
      screen.getByRole("link", { name: "通讯录" }),
      screen.getByRole("link", { name: "项目" }),
      screen.getByRole("link", { name: "打开即应官网" }),
      screen.getByRole("link", { name: "在 GitHub 查看即应" }),
      screen.getByRole("button", { name: "配色：跟随系统" }),
      screen.getByRole("button", { name: "设置" }),
    ]

    for (const control of leftRailControls) {
      expect(control.querySelector("svg")).toHaveClass("size-5")
    }
  })

  it("仅按入站 pending 申请显示通讯录提醒，不影响聊天未读标签", () => {
    mocks.clientData.incomingFriendRequests = [{ status: "pending" }, { status: "accepted" }]

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>,
    )

    expect(screen.getByRole("link", { name: "通讯录，有待处理的新朋友申请" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "聊天" })).toBeInTheDocument()
  })

  it("renders the desktop update action in the sidebar footer", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout footerAction={<button>新版本</button>} />
      </MemoryRouter>,
    )

    const sidebar = screen.getByRole("complementary")
    expect(within(sidebar).getByRole("button", { name: "新版本" })).toBeInTheDocument()
  })

  it("keeps profile in the avatar menu and moves settings to the sidebar footer", async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole("button", { name: "用户菜单" }))

    expect(screen.getByRole("menuitem", { name: /个人资料/ })).toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: /^设置$/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole("menuitem", { name: /个人资料/ }))

    const profileDialog = await screen.findByRole("dialog", {
      name: "个人资料",
    })
    expect(within(profileDialog).getByLabelText("昵称")).toBeInTheDocument()
    expect(within(profileDialog).queryByText("桌面通知")).not.toBeInTheDocument()

    await user.click(within(profileDialog).getByRole("button", { name: "关闭" }))
    await user.click(screen.getByRole("button", { name: "设置" }))

    const settingsDialog = await screen.findByRole("dialog", { name: "设置" })
    expect(within(settingsDialog).getByText("桌面通知")).toBeInTheDocument()
    expect(within(settingsDialog).queryByLabelText("昵称")).not.toBeInTheDocument()
  })

  it("lets the desktop host handle the shared settings entry", async () => {
    const user = userEvent.setup()
    const openSettings = vi.fn()
    const restoreHost = configureDesktopHost({ openSettings })

    try {
      render(
        <MemoryRouter initialEntries={["/chat"]}>
          <AppLayout />
        </MemoryRouter>,
      )

      await user.click(screen.getByRole("button", { name: "设置" }))

      expect(openSettings).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole("dialog", { name: "设置" })).not.toBeInTheDocument()
    } finally {
      restoreHost()
    }
  })

  it("does not show the client download entry in the desktop sidebar", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>,
    )

    expect(screen.queryByRole("button", { name: "下载客户端" })).not.toBeInTheDocument()
  })

  it("opens the MagicChat repository in a new tab", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>,
    )

    expect(screen.getByRole("link", { name: "在 GitHub 查看即应" })).toMatchObject({
      href: "https://github.com/chaitin/MagicChat",
      rel: "noopener noreferrer",
      target: "_blank",
    })
  })

  it("通过统一外链入口打开固定官网", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>,
    )

    const websiteLink = screen.getByRole("link", { name: "打开即应官网" })

    expect(websiteLink).toMatchObject({
      href: "https://jiying.chat/",
      rel: "noopener noreferrer",
      target: "_blank",
    })
    expect(websiteLink.querySelector("svg.lucide-house")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "下载客户端" })).not.toBeInTheDocument()
  })

  it("stays on the login page after logout", async () => {
    const user = userEvent.setup()
    mocks.clientLogout.mockResolvedValue(undefined)

    render(<LogoutFlow />)

    await user.click(screen.getByRole("button", { name: "用户菜单" }))
    await user.click(screen.getByRole("menuitem", { name: "退出登录" }))

    const dialog = await screen.findByRole("alertdialog", {
      name: "确认退出登录",
    })
    await user.click(within(dialog).getByRole("button", { name: "退出登录" }))

    expect(await screen.findByRole("heading", { name: "即应 智能协作平台" })).toBeInTheDocument()
    expect(screen.queryByTestId("init-page")).not.toBeInTheDocument()
    expect(mocks.clientLogout).toHaveBeenCalledTimes(1)
    expect(mocks.clientData.clearMessageScope).toHaveBeenCalledTimes(1)
    expect(mocks.clientLogout.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clientData.clearMessageScope.mock.invocationCallOrder[0],
    )
  })

  it("远端退出失败时保留本地会话", async () => {
    const user = userEvent.setup()
    mocks.clientLogout.mockRejectedValue(new Error("network unavailable"))

    render(<LogoutFlow />)

    await user.click(screen.getByRole("button", { name: "用户菜单" }))
    await user.click(screen.getByRole("menuitem", { name: "退出登录" }))
    const dialog = await screen.findByRole("alertdialog", { name: "确认退出登录" })
    await user.click(within(dialog).getByRole("button", { name: "退出登录" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())

    expect(screen.queryByRole("heading", { name: "即应 智能协作平台" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "用户菜单" })).toBeInTheDocument()
    expect(mocks.clientLogout).toHaveBeenCalledTimes(1)
    expect(mocks.clientData.clearMessageScope).not.toHaveBeenCalled()
  })
})

function LogoutFlow() {
  const [authenticated, setAuthenticated] = useState(true)

  return (
    <AppInfoContext.Provider
      value={{
        ...defaultAppInfo,
        authenticated,
        setAuthenticated,
      }}
    >
      <MemoryRouter initialEntries={["/chat"]}>
        <Routes>
          <Route element={<AppLayout />} path="/chat" />
          <Route element={<LoginPage />} path="/login" />
          <Route element={<div data-testid="init-page" />} path="/init" />
        </Routes>
      </MemoryRouter>
    </AppInfoContext.Provider>
  )
}
