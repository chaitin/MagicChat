import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { UserSettingsDialog } from "@/components/user-settings-dialog"

const mocks = vi.hoisted(() => ({
  permission: "default" as "default" | "denied" | "granted" | "unsupported",
  playMessageNotificationSound: vi.fn(),
  requestBrowserNotificationPermission: vi.fn(),
}))

vi.mock("@/lib/browser-notifications", () => ({
  getBrowserNotificationPermission: () => mocks.permission,
  requestBrowserNotificationPermission:
    mocks.requestBrowserNotificationPermission,
}))

vi.mock("@/lib/message-notification-sound", () => ({
  playMessageNotificationSound: mocks.playMessageNotificationSound,
}))

describe("UserSettingsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mocks.permission = "default"
    mocks.requestBrowserNotificationPermission.mockResolvedValue("granted")
  })

  it("unlocks the message sound before enabling desktop notifications", async () => {
    const user = userEvent.setup()
    render(<UserSettingsDialog onOpenChange={() => undefined} open />)

    const desktopNotificationSwitch = screen.getByRole("switch", {
      name: "桌面通知",
    })
    expect(desktopNotificationSwitch).not.toBeChecked()

    await user.click(desktopNotificationSwitch)

    expect(mocks.playMessageNotificationSound).toHaveBeenCalledOnce()
    expect(mocks.requestBrowserNotificationPermission).toHaveBeenCalledOnce()
    expect(
      mocks.playMessageNotificationSound.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocks.requestBrowserNotificationPermission.mock.invocationCallOrder[0]
    )
    expect(screen.getByText("桌面通知已开启")).toBeInTheDocument()
    expect(desktopNotificationSwitch).toBeChecked()
  })

  it("persists desktop notifications being disabled", async () => {
    const user = userEvent.setup()
    mocks.permission = "granted"
    const { unmount } = render(
      <UserSettingsDialog onOpenChange={() => undefined} open />
    )
    const desktopNotificationSwitch = screen.getByRole("switch", {
      name: "桌面通知",
    })

    expect(desktopNotificationSwitch).toBeChecked()

    await user.click(desktopNotificationSwitch)

    expect(desktopNotificationSwitch).not.toBeChecked()
    expect(screen.getByText("桌面通知已关闭")).toBeInTheDocument()
    expect(
      window.localStorage.getItem(
        "client-web:browser-message-notification-enabled"
      )
    ).toBe("false")

    unmount()
    render(<UserSettingsDialog onOpenChange={() => undefined} open />)

    expect(screen.getByRole("switch", { name: "桌面通知" })).not.toBeChecked()
  })

  it("enables the notification sound by default and persists changes", async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <UserSettingsDialog onOpenChange={() => undefined} open />
    )
    const soundSwitch = screen.getByRole("switch", {
      name: "消息通知铃声",
    })

    expect(soundSwitch).toBeChecked()

    await user.click(soundSwitch)

    expect(soundSwitch).not.toBeChecked()
    expect(
      window.localStorage.getItem(
        "client-web:message-notification-sound-enabled"
      )
    ).toBe("false")

    unmount()
    render(<UserSettingsDialog onOpenChange={() => undefined} open />)

    expect(
      screen.getByRole("switch", { name: "消息通知铃声" })
    ).not.toBeChecked()
  })
})
