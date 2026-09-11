import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { AppProfileDialog } from "@/components/contacts/app-profile-dialog"
import type { ContactUser } from "@/lib/client-data-api"
import type { ClientOwnedApp } from "@/lib/client-api/apps"

const mocks = vi.hoisted(() => ({
  prepareAppAvatar: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  updateClientApp: vi.fn(),
  uploadClientAppAvatar: vi.fn(),
}))

vi.mock("@/lib/app-avatar-processing", () => ({
  prepareAppAvatar: mocks.prepareAppAvatar,
}))

vi.mock("@/lib/client-api/apps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client-api/apps")>()),
  updateClientApp: mocks.updateClientApp,
  uploadClientAppAvatar: mocks.uploadClientAppAvatar,
}))

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}))

describe("AppProfileDialog", () => {
  beforeAll(() => {
    Object.defineProperties(HTMLElement.prototype, {
      hasPointerCapture: {
        configurable: true,
        value: () => false,
      },
      releasePointerCapture: {
        configurable: true,
        value: () => undefined,
      },
      scrollIntoView: {
        configurable: true,
        value: () => undefined,
      },
      setPointerCapture: {
        configurable: true,
        value: () => undefined,
      },
    })
  })

  beforeEach(() => {
    mocks.prepareAppAvatar.mockReset()
    mocks.toastError.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.updateClientApp.mockReset()
    mocks.uploadClientAppAvatar.mockReset()
  })

  it("shows the application identity and saves all profile fields together", async () => {
    const user = userEvent.setup()
    const onAppChange = vi.fn()
    const onOpenChange = vi.fn()
    const app = createApp()
    const updatedApp = {
      ...app,
      description: "生成团队分析报告",
      name: "新版分析助手",
    }
    mocks.updateClientApp.mockResolvedValueOnce(updatedApp)

    renderProfileDialog({ app, onAppChange, onOpenChange })

    const dialog = screen.getByRole("dialog", { name: "修改应用资料" })
    const avatarButton = within(dialog).getByRole("button", {
      name: "更换应用头像",
    })
    const saveButton = within(dialog).getByRole("button", { name: "保存" })
    const closeButton = within(dialog).getByRole("button", { name: "关闭" })
    expect(saveButton).toHaveAttribute("data-variant", "default")
    expect(closeButton).toHaveAttribute("data-variant", "secondary")
    expect(saveButton).toBeDisabled()

    const nameInput = within(dialog).getByLabelText("应用名称")
    expect(avatarButton.parentElement).toContainElement(nameInput)
    await user.clear(nameInput)
    await user.type(nameInput, "新版分析助手")
    const descriptionInput = within(dialog).getByLabelText("应用描述")
    expect(descriptionInput.tagName).toBe("TEXTAREA")
    await user.clear(descriptionInput)
    await user.type(descriptionInput, "生成团队分析报告")

    expect(mocks.updateClientApp).not.toHaveBeenCalled()
    expect(
      within(dialog).queryByRole("button", { name: "保存应用名称" })
    ).not.toBeInTheDocument()
    expect(saveButton).toBeEnabled()
    await user.click(saveButton)

    await waitFor(() =>
      expect(mocks.updateClientApp).toHaveBeenCalledWith("app-1", {
        description: "生成团队分析报告",
        name: "新版分析助手",
        userIds: [],
        visibility: "creator",
      })
    )
    expect(onAppChange).toHaveBeenLastCalledWith(updatedApp)
    expect(mocks.toastSuccess).toHaveBeenCalledWith("应用资料已保存")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("saves restricted access with the selected users", async () => {
    const user = userEvent.setup()
    const app = createApp()
    const grantableUser = createUser()
    mocks.updateClientApp.mockResolvedValueOnce({
      ...app,
      userIds: [grantableUser.id],
      visibility: "restricted",
    })

    renderProfileDialog({ app, users: [grantableUser] })

    await user.click(screen.getByRole("combobox", { name: "访问范围" }))
    await user.click(screen.getByRole("option", { name: "部分用户" }))
    const saveButton = screen.getByRole("button", { name: "保存" })
    expect(saveButton).toBeDisabled()

    await user.click(screen.getByLabelText("选择可访问用户"))
    await user.click(screen.getByRole("option", { name: /Alice/ }))
    expect(saveButton).toBeEnabled()
    await user.click(saveButton)

    await waitFor(() =>
      expect(mocks.updateClientApp).toHaveBeenCalledWith("app-1", {
        description: "分析消息",
        name: "分析助手",
        userIds: ["user-2"],
        visibility: "restricted",
      })
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith("应用资料已保存")
  })

  it("keeps a selected avatar as a draft until the profile is saved", async () => {
    const user = userEvent.setup()
    const app = createApp()
    const sourceFile = new File(["source"], "avatar.png", {
      type: "image/png",
    })
    const preparedFile = new File(["prepared"], "avatar.webp", {
      type: "image/webp",
    })
    mocks.prepareAppAvatar.mockResolvedValueOnce({
      file: preparedFile,
      previewUrl: "data:image/webp;base64,cHJldmlldw==",
    })
    mocks.uploadClientAppAvatar.mockResolvedValueOnce({
      ...app,
      avatar: "https://files.example.test/app-1.webp",
    })

    renderProfileDialog({ app })

    const dialog = screen.getByRole("dialog", { name: "修改应用资料" })
    const fileInput =
      dialog.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    await user.upload(fileInput!, sourceFile)

    await waitFor(() =>
      expect(mocks.prepareAppAvatar).toHaveBeenCalledWith(sourceFile)
    )
    expect(mocks.uploadClientAppAvatar).not.toHaveBeenCalled()
    expect(mocks.updateClientApp).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "保存" }))

    await waitFor(() =>
      expect(mocks.uploadClientAppAvatar).toHaveBeenCalledWith(
        "app-1",
        preparedFile
      )
    )
    expect(mocks.updateClientApp).not.toHaveBeenCalled()
  })
})

function renderProfileDialog({
  app = createApp(),
  onAppChange = vi.fn(),
  onOpenChange = vi.fn(),
  users = [],
}: {
  app?: ClientOwnedApp
  onAppChange?: (app: ClientOwnedApp) => void
  onOpenChange?: (open: boolean) => void
  users?: ContactUser[]
} = {}) {
  return render(
    <AppProfileDialog
      app={app}
      currentUserId="current-user"
      onAppChange={onAppChange}
      onOpenChange={onOpenChange}
      open
      users={users}
    />
  )
}

function createApp(): ClientOwnedApp {
  return {
    avatar: "",
    connectionStatus: "offline",
    createdAt: "2026-07-17T07:00:00Z",
    description: "分析消息",
    enabled: true,
    id: "app-1",
    name: "分析助手",
    updatedAt: "2026-07-17T07:00:00Z",
    userIds: [],
    visibility: "creator",
  }
}

function createUser(): ContactUser {
  return {
    avatar: "",
    email: "alice@example.com",
    id: "user-2",
    lastOnlineAt: null,
    name: "Alice",
    nickname: "",
    online: true,
    phone: "",
    type: "user",
  }
}
