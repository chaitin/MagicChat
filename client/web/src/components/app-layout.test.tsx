import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AppLayout } from "@/components/app-layout"
import { LoginPage } from "@/pages/login-page"
import { defaultAppInfo } from "@/lib/app-info"
import { AppInfoContext } from "@/lib/app-info-context"

const mocks = vi.hoisted(() => ({
  clientData: {
    conversations: [] as Array<{
      notificationMuted?: boolean
      unreadCount: number
    }>,
    incomingFriendRequests: [] as Array<{ status: string }>,
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
  mocks.clientData.conversations = []
  mocks.clientData.incomingFriendRequests = []
})

afterEach(() => {
  vi.unstubAllGlobals()
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

vi.mock("@/lib/client-auth", () => ({
  clientLogout: mocks.clientLogout,
}))

vi.mock("@/lib/client-data-api", () => ({
  updateCurrentClientUser: mocks.updateCurrentClientUser,
  uploadCurrentClientAvatar: mocks.uploadCurrentClientAvatar,
}))

describe("AppLayout", () => {
  it("does not include muted conversations in the global unread indicator", () => {
    mocks.clientData.conversations = [
      { notificationMuted: true, unreadCount: 8 },
    ]

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    expect(screen.getByLabelText("聊天")).toBeInTheDocument()
    expect(screen.queryByLabelText("聊天，有未读消息")).not.toBeInTheDocument()
  })

  it("shows a notification dot on contacts for pending friend requests", () => {
    mocks.clientData.incomingFriendRequests = [{ status: "pending" }]

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    expect(screen.getByLabelText("通讯录，有新的好友申请")).toBeInTheDocument()
  })

  it("splits profile and settings actions in the user avatar menu", async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    await user.click(screen.getByRole("button", { name: "用户菜单" }))

    expect(
      screen.getByRole("menuitem", { name: /个人资料/ })
    ).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: /^设置$/ })).toBeInTheDocument()

    await user.click(screen.getByRole("menuitem", { name: /个人资料/ }))

    const profileDialog = await screen.findByRole("dialog", {
      name: "个人资料",
    })
    expect(within(profileDialog).getByLabelText("昵称")).toBeInTheDocument()
    expect(
      within(profileDialog).queryByText("桌面通知")
    ).not.toBeInTheDocument()

    await user.click(
      within(profileDialog).getByRole("button", { name: "关闭" })
    )
    await user.click(screen.getByRole("button", { name: "用户菜单" }))
    await user.click(screen.getByRole("menuitem", { name: /^设置$/ }))

    const settingsDialog = await screen.findByRole("dialog", { name: "设置" })
    expect(within(settingsDialog).getByText("桌面通知")).toBeInTheDocument()
    expect(
      within(settingsDialog).queryByLabelText("昵称")
    ).not.toBeInTheDocument()
  })

  it("shows download options for all client platforms", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            android: { url: "https://downloads.example/client.apk" },
            "linux-amd": {
              url: "https://downloads.example/client-x64.AppImage",
            },
            "linux-arm": {
              url: "https://downloads.example/client-arm64.AppImage",
            },
            macos: { url: "https://downloads.example/client.dmg" },
            windows: { url: "https://downloads.example/client.exe" },
          }),
        ok: true,
      })
    )

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    const downloadButton = screen.getByRole("button", { name: "下载客户端" })

    await user.click(downloadButton)

    const dialog = await screen.findByRole("dialog", { name: "下载客户端" })
    expect(within(dialog).getByText("Windows")).toBeInTheDocument()
    expect(within(dialog).getByText("macOS")).toBeInTheDocument()
    expect(within(dialog).getByText("Android")).toBeInTheDocument()
    expect(within(dialog).getByText("Linux")).toBeInTheDocument()
    expect(within(dialog).getByText("iOS")).toBeInTheDocument()
    expect(
      within(dialog).getByRole("link", {
        name: "下载 Windows 客户端",
      })
    ).toMatchObject({
      href: "https://downloads.example/client.exe",
      target: "_blank",
    })
    expect(
      within(dialog).getByRole("link", {
        name: "下载 macOS 客户端",
      })
    ).toMatchObject({
      href: "https://downloads.example/client.dmg",
      target: "_blank",
    })
    expect(
      within(dialog).getByRole("link", {
        name: "下载 Android 客户端",
      })
    ).toMatchObject({
      href: "https://downloads.example/client.apk",
      target: "_blank",
    })
    expect(
      within(dialog).getAllByRole("button", {
        name: "iOS 客户端敬请期待",
      })
    ).toHaveLength(1)
    await user.click(
      within(dialog).getByRole("button", { name: "下载 Linux 客户端" })
    )
    expect(
      screen.getByRole("menuitem", {
        name: "下载 Linux x64 / AMD64 客户端",
      })
    ).toMatchObject({
      href: "https://downloads.example/client-x64.AppImage",
      target: "_blank",
    })
    expect(
      screen.getByRole("menuitem", {
        name: "下载 Linux ARM64 客户端",
      })
    ).toMatchObject({
      href: "https://downloads.example/client-arm64.AppImage",
      target: "_blank",
    })

    await user.keyboard("{Escape}")
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute("data-state", "open")
  })

  it("opens the product homepage in a new tab", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    expect(screen.getByRole("link", { name: "访问即应官网" })).toMatchObject({
      href: "https://jiying.chat/",
      rel: "noopener noreferrer",
      target: "_blank",
    })
  })

  it("opens the MagicChat repository in a new tab", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <AppLayout />
      </MemoryRouter>
    )

    expect(
      screen.getByRole("link", { name: "在 GitHub 查看 MagicChat" })
    ).toMatchObject({
      href: "https://github.com/chaitin/MagicChat",
      rel: "noopener noreferrer",
      target: "_blank",
    })
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

    expect(
      await screen.findByRole("heading", { name: "即应 智能协作平台" })
    ).toBeInTheDocument()
    expect(screen.queryByTestId("init-page")).not.toBeInTheDocument()
    expect(mocks.clientLogout).toHaveBeenCalledTimes(1)
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
