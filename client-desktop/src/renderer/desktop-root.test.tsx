import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { StrictMode, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DesktopRoot } from "./desktop-root"
import { releaseChannelLabel } from "@/release-channel"
import {
  DESKTOP_TITLEBAR_HEIGHT,
  type DesktopAppInfo,
  type DesktopBridge,
  type ServerProfile,
  type UpdaterState,
} from "@shared/bridge"
import type { ScreenshotStartFailure } from "@shared/screenshot-contract"

vi.unmock("@/components/locale-provider")

const profile: ServerProfile = {
  createdAt: "2026-07-23T00:00:00.000Z",
  displayName: "测试服务器",
  id: "server-1",
  normalizedUrl: "https://chat.example.com",
}
const documentId = "550e8400-e29b-41d4-a716-446655440000"
const documentUrl = `${profile.normalizedUrl}/documents/document/${documentId}`

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
)

const mocks = vi.hoisted(() => ({
  externalLinkHandler: undefined as ((url: string) => void) | undefined,
  desktopHostOptions: undefined as
    | {
        createRealtimeClient?: unknown
        setBadge?: unknown
        setTrayMessages?: unknown
        showMessageNotification?: unknown
      }
    | undefined,
  hostOpenExternal: undefined as ((url: string) => Promise<void>) | undefined,
  openManual: vi.fn(),
  openRelease: vi.fn(),
  openSettings: undefined as (() => void) | undefined,
  messageNotificationSoundEnabled: undefined as (() => boolean) | undefined,
  installDesktopFetch: vi.fn(),
  remove: vi.fn(),
  screenshotStartFailureSubscriber: undefined as
    | ((failure: ScreenshotStartFailure) => void)
    | undefined,
  screenshotStartFailureUnsubscribe: vi.fn(),
  showScreenshotStartError: vi.fn(),
  restoreFetch: vi.fn(),
  shellOpenExternal: vi.fn(),
}))

vi.mock("@/app/App", () => ({
  default: ({ updatePrompt }: { updatePrompt?: ReactNode }) => (
    <div>
      <aside aria-label="应用侧边栏">{updatePrompt}</aside>
      <button onClick={() => mocks.openSettings?.()}>打开设置</button>
    </div>
  ),
}))

vi.mock("@/lib/desktop-host", () => ({
  configureDesktopHost: (options: {
    createRealtimeClient?: unknown
    messageNotificationSoundEnabled?(): boolean
    openExternal?(url: string): Promise<void>
    openSettings(): void
    setBadge?: unknown
    setTrayMessages?: unknown
    showMessageNotification?: unknown
  }) => {
    mocks.desktopHostOptions = options
    mocks.hostOpenExternal = options.openExternal
    mocks.openSettings = options.openSettings
    mocks.messageNotificationSoundEnabled = options.messageNotificationSoundEnabled
    return () => {
      mocks.desktopHostOptions = undefined
      mocks.hostOpenExternal = undefined
      mocks.openSettings = undefined
      mocks.messageNotificationSoundEnabled = undefined
    }
  },
  createDesktopRealtimeClient: vi.fn(),
}))

vi.mock("@/lib/desktop-link-navigation", () => ({
  installDesktopLinkNavigation: (handler: (url: string) => void) => {
    mocks.externalLinkHandler = handler
    return () => {
      mocks.externalLinkHandler = undefined
    }
  },
}))

vi.mock("@/lib/desktop-resource-url", () => ({
  resolveDesktopResourceUrl: (_profile: ServerProfile, url: string) => url,
}))

vi.mock("@/lib/screenshot-start-error", () => ({
  showScreenshotStartError: mocks.showScreenshotStartError,
}))

vi.mock("./desktop-transport", () => ({
  DesktopWebSocket: class DesktopWebSocket {},
  installDesktopFetch: mocks.installDesktopFetch,
}))

describe("桌面设置服务器管理", () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove("dark", "light")
    document.documentElement.removeAttribute("data-color-theme")
    document.documentElement.style.fontSize = ""
    mocks.externalLinkHandler = undefined
    mocks.desktopHostOptions = undefined
    mocks.hostOpenExternal = undefined
    mocks.openSettings = undefined
    mocks.messageNotificationSoundEnabled = undefined
    mocks.screenshotStartFailureSubscriber = undefined
    mocks.screenshotStartFailureUnsubscribe.mockReset()
    mocks.showScreenshotStartError.mockReset()
    mocks.installDesktopFetch.mockReset().mockReturnValue(mocks.restoreFetch)
    mocks.openManual.mockReset().mockResolvedValue(undefined)
    mocks.openRelease.mockReset().mockResolvedValue(undefined)
    mocks.remove.mockResolvedValue(true)
    mocks.restoreFetch.mockReset()
    mocks.shellOpenExternal.mockReset().mockResolvedValue(undefined)
    vi.spyOn(window, "confirm").mockReturnValue(true)
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: createDesktopBridge(),
    })
  })

  afterEach(() => {
    if (scrollIntoViewDescriptor) {
      Object.defineProperty(Element.prototype, "scrollIntoView", scrollIntoViewDescriptor)
    } else {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
    vi.restoreAllMocks()
  })

  it("全局截图快捷键权限失败时展示 Renderer 权限提示并清理订阅", async () => {
    const view = render(<DesktopRoot />)

    await waitFor(() => expect(mocks.screenshotStartFailureSubscriber).toBeTypeOf("function"))
    act(() => {
      mocks.screenshotStartFailureSubscriber?.({ code: "permission_denied" })
    })

    expect(mocks.showScreenshotStartError).toHaveBeenCalledWith(
      "permission_denied",
      expect.any(Function),
    )
    view.unmount()
    expect(mocks.screenshotStartFailureUnsubscribe).toHaveBeenCalledOnce()
  })

  it("Windows 顶栏在 Logo 右侧展示即应名称", async () => {
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: createDesktopBridge(undefined, undefined, "win32"),
    })

    render(<DesktopRoot />)

    expect(await screen.findByText("即应")).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "即应" })).not.toBeInTheDocument()
  })

  it("Linux 顶栏保留 Logo 且不展示 Windows 名称", async () => {
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: createDesktopBridge(undefined, undefined, "linux"),
    })

    render(<DesktopRoot />)

    expect(await screen.findByRole("img", { name: "即应" })).toBeInTheDocument()
    expect(screen.queryByText("即应")).not.toBeInTheDocument()
  })

  it("启动加载页只展示即应空间文案", async () => {
    const bridge = createDesktopBridge()
    const profiles = deferred<ReadonlyArray<ServerProfile>>()
    bridge.servers.list = vi.fn(() => profiles.promise)
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })

    render(<DesktopRoot />)

    expect(await screen.findByText("正在准备你的即应空间")).toBeVisible()
    expect(screen.queryByText("正在启动即应")).not.toBeInTheDocument()

    await act(async () => profiles.resolve([profile]))
  })

  it("macOS 顶栏为原生交通灯保留左侧空间", async () => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })

    render(<DesktopRoot />)

    await waitFor(() => expect(bridge.app.info).toHaveBeenCalled())
    expect(screen.queryByRole("img", { name: "即应" })).not.toBeInTheDocument()
  })

  it("macOS 工作区页面统一将顶部区域作为窗口拖拽区", async () => {
    const source = await readFile(path.resolve(process.cwd(), "src/renderer/styles.css"), "utf8")

    expect(source).toContain(
      '.desktop-frame[data-platform="darwin"]:has(.app-layout-shell) .desktop-titlebar-drag-region',
    )
    expect(source).toContain("--desktop-macos-navigation-rail-width: 72px")
    expect(source).toMatch(
      /\.desktop-frame\[data-platform="darwin"\]:has\(\.app-layout-shell\) \.desktop-titlebar-drag-region\s*\{[^}]*width:\s*var\(--desktop-macos-navigation-rail-width\)/,
    )
    expect(source).toMatch(
      /\.desktop-frame\[data-platform="darwin"\] \.(?:app-navigation-rail)\s*\{[^}]*-webkit-app-region:\s*drag[^}]*margin-top:\s*var\(--desktop-titlebar-height\)[^}]*width:\s*var\(--desktop-macos-navigation-rail-width\)/,
    )
    expect(source).toMatch(
      /\.app-layout-shell\s+\[data-desktop-drag-region\]\s*\{\s*-webkit-app-region: drag/,
    )
    expect(source).toContain(".desktop-workspace-drag-region")
    expect(source).toMatch(
      /\[data-slot="dialog-overlay"\],\s*\[data-slot="dialog-content"\]\s*\{[^}]*-webkit-app-region:\s*no-drag/,
    )
  })

  it("文档子窗口优先使用 URL 中的 serverId，不受全局服务器选择影响", async () => {
    const originalRoute = `${window.location.pathname}${window.location.search}`
    window.history.pushState(
      {},
      "",
      "/documents/document/550e8400-e29b-41d4-a716-446655440000?serverId=server-1&window=document",
    )
    const bridge = createDesktopBridge()
    const otherProfile: ServerProfile = {
      ...profile,
      displayName: "其他服务器",
      id: "server-2",
      normalizedUrl: "https://other.example.com",
    }
    vi.mocked(bridge.servers.list).mockResolvedValue([profile, otherProfile])
    vi.mocked(bridge.settings.get).mockResolvedValue({
      ...(await bridge.settings.get()),
      selectedServerId: otherProfile.id,
    })
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })

    try {
      render(<DesktopRoot />)
      await waitFor(() =>
        expect(mocks.installDesktopFetch).toHaveBeenCalledWith(
          expect.objectContaining({ id: profile.id }),
        ),
      )
      expect(mocks.desktopHostOptions?.createRealtimeClient).toBeUndefined()
      expect(mocks.desktopHostOptions?.setBadge).toBeUndefined()
      expect(mocks.desktopHostOptions?.setTrayMessages).toBeUndefined()
      expect(mocks.desktopHostOptions?.showMessageNotification).toBeUndefined()
    } finally {
      window.history.replaceState({}, "", originalRoute || "/")
    }
  })

  it("平台信息返回前不把设置中心误判为 Windows 或 Linux 布局", async () => {
    const bridge = createDesktopBridge()
    let resolveAppInfo!: (info: DesktopAppInfo) => void
    const appInfo = new Promise<DesktopAppInfo>((resolve) => {
      resolveAppInfo = resolve
    })
    bridge.app.info = vi.fn(() => appInfo)
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    const settings = screen.getByRole("dialog", { name: "设置" })
    expect(settings).not.toHaveClass("settings-center-below-titlebar")

    resolveAppInfo({
      arch: "x64",
      build: "test",
      channel: "test",
      packaged: false,
      platform: "win32",
      version: "0.1.0",
    })

    await waitFor(() => expect(settings).toHaveClass("settings-center-below-titlebar"))
  })

  it.each(["win32", "linux"])("%s 设置中心位于应用顶栏下方", async (platform) => {
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: createDesktopBridge(undefined, undefined, platform),
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    if (platform === "win32") await screen.findByText("即应")
    else await screen.findByRole("img", { name: "即应" })
    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    const settings = screen.getByRole("dialog", { name: "设置" })
    const styles = await readFile(
      path.resolve(process.cwd(), "src/renderer/settings-center.css"),
      "utf8",
    )

    expect(settings).toHaveClass("settings-center", "settings-center-below-titlebar")
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass(
      "settings-center-overlay-below-titlebar",
    )
    expect(DESKTOP_TITLEBAR_HEIGHT).toBeGreaterThan(0)
    expect(styles).toMatch(
      /\.settings-center-below-titlebar\s*\{[^}]*height:\s*min\(620px, calc\(100vh - var\(--desktop-titlebar-height\) - 32px\)\)/,
    )
    expect(styles).toMatch(
      /\.settings-center-overlay-below-titlebar\s*\{[^}]*top:\s*var\(--desktop-titlebar-height\)/,
    )
  })

  it("macOS 设置中心保持主窗口内的大尺寸布局", async () => {
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await waitFor(() => expect(window.desktop.app.info).toHaveBeenCalled())
    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    const settings = screen.getByRole("dialog", { name: "设置" })

    expect(settings).toHaveClass("settings-center")
    await waitFor(() => expect(settings).not.toHaveClass("settings-center-below-titlebar"))
  })

  it("设置中心使用右上角关闭按钮", async () => {
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    const closeButton = screen.getByRole("button", { name: "关闭设置" })
    const settingsHeader = closeButton.closest("header")

    expect(settingsHeader?.lastElementChild).toBe(closeButton)
    await user.click(closeButton)
    expect(screen.queryByRole("dialog", { name: "设置" })).not.toBeInTheDocument()
  })

  it("移除成功后回到服务器输入页面", async () => {
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "工作空间" }))
    await user.click(await screen.findByRole("button", { name: "移除服务器" }))

    expect(await screen.findByRole("heading", { name: "开始使用即应" })).toBeInTheDocument()
    expect(screen.getByText("A BETTER WAY TO WORK")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /从沟通到行动/ })).toBeInTheDocument()
    expect(mocks.remove).toHaveBeenCalledWith(profile.id)
    expect(screen.getByLabelText("服务器地址")).toHaveValue("")
  })

  it("新增无本地登录态的服务器时跳转登录页", async () => {
    const originalLocation = `${window.location.pathname}${window.location.search}`
    const nextProfile: ServerProfile = {
      ...profile,
      displayName: "本地服务器",
      id: "server-local",
      normalizedUrl: "http://localhost:20080",
    }
    const bridge = createDesktopBridge()
    let items: ServerProfile[] = []
    vi.mocked(bridge.servers.list).mockImplementation(async () => items)
    vi.mocked(bridge.servers.add).mockImplementation(async () => {
      items = [nextProfile]
      return nextProfile
    })
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    window.history.replaceState({}, "", "/chat/conversation-from-removed-server")
    const user = userEvent.setup()
    const view = render(<DesktopRoot />)

    try {
      await user.type(await screen.findByLabelText("服务器地址"), nextProfile.normalizedUrl)
      await user.click(screen.getByRole("button", { name: "连接并继续" }))

      await waitFor(() => expect(window.location.pathname).toBe("/login"))
      expect(bridge.servers.select).toHaveBeenCalledWith(nextProfile.id)
    } finally {
      view.unmount()
      window.history.replaceState({}, "", originalLocation || "/")
    }
  })

  it("未同步文档取消关闭后保留当前服务器和设置窗口", async () => {
    mocks.remove.mockResolvedValueOnce(false)
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "工作空间" }))
    await user.click(await screen.findByRole("button", { name: "移除服务器" }))

    expect(mocks.remove).toHaveBeenCalledWith(profile.id)
    expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "开始使用即应" })).not.toBeInTheDocument()
  })

  it("StrictMode 下忽略已失效的启动结果，避免提前挂载工作区", async () => {
    const bridge = createDesktopBridge()
    const firstProfiles = deferred<ServerProfile[]>()
    const currentProfiles = deferred<ServerProfile[]>()
    vi.mocked(bridge.servers.list)
      .mockReset()
      .mockReturnValueOnce(firstProfiles.promise)
      .mockReturnValueOnce(currentProfiles.promise)
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })

    render(
      <StrictMode>
        <DesktopRoot />
      </StrictMode>,
    )
    await waitFor(() => expect(bridge.servers.list).toHaveBeenCalledTimes(2))

    await act(async () => firstProfiles.resolve([{ ...profile }]))
    expect(mocks.installDesktopFetch).not.toHaveBeenCalled()

    await act(async () => currentProfiles.resolve([{ ...profile }]))
    await screen.findByRole("button", { name: "打开设置" })
    expect(mocks.installDesktopFetch).toHaveBeenCalledTimes(2)
    expect(mocks.restoreFetch).toHaveBeenCalledOnce()
  })

  it("配置页使用应用主题变量且不再绘制突兀圆形装饰", async () => {
    const source = await readFile(path.resolve(process.cwd(), "src/renderer/styles.css"), "utf8")

    expect(source).not.toContain(".server-setup-hero::after")
    expect(source).toContain(".dark .server-setup")
    expect(source).toMatch(/\.server-setup\s*\{[^}]*align-items:\s*stretch/)
    expect(source).toContain("max-width: none")
    expect(source).toContain("border-radius: 0")
  })

  it("移除失败时保留设置并显示错误", async () => {
    mocks.remove.mockRejectedValueOnce(new Error("本地配置写入失败"))
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "工作空间" }))
    await user.click(await screen.findByRole("button", { name: "移除服务器" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("本地配置写入失败")
    expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument()
  })

  it("设置读取失败后提供重试并恢复内容", async () => {
    const bridge = createDesktopBridge()
    const initialSettings = await bridge.settings.get()
    let settingsCalls = 0
    vi.mocked(bridge.settings.get)
      .mockReset()
      .mockImplementation(async () => {
        settingsCalls += 1
        if (settingsCalls === 3) throw new Error("IPC unavailable")
        return initialSettings
      })
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("设置读取失败，请重试")

    await user.click(screen.getByRole("button", { name: "重试" }))
    expect(await screen.findByText("开机自动启动")).toBeInTheDocument()
  })

  it("工作空间重命名失败时保留输入并展示反馈", async () => {
    const bridge = createDesktopBridge()
    vi.mocked(bridge.servers.rename).mockRejectedValueOnce(new Error("persist failed"))
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "工作空间" }))
    const nameInput = screen.getByRole("textbox")
    await user.clear(nameInput)
    await user.type(nameInput, "新的工作空间")
    await user.click(screen.getByRole("button", { name: "保存" }))

    expect(await screen.findByText("工作空间名称保存失败，请重试")).toBeInTheDocument()
    expect(nameInput).toHaveValue("新的工作空间")
  })

  it("工作空间移除操作位于服务器地址行右侧", async () => {
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "工作空间" }))
    const removeButton = screen.getByRole("button", { name: "移除服务器" })
    const addressRow = screen.getByText(profile.normalizedUrl).closest(".settings-row")

    expect(addressRow).not.toBeNull()
    expect(addressRow).toContainElement(removeButton)
    expect(removeButton).toHaveClass("settings-danger-button")
  })

  it("设置窗口使用紧凑尺寸且选中分类沿用应用主色", async () => {
    const styles = await readFile(
      path.resolve(process.cwd(), "src/renderer/settings-center.css"),
      "utf8",
    )

    expect(styles).toMatch(/\.settings-center\s*\{[^}]*height:\s*min\(640px,/)
    expect(styles).toMatch(/\.settings-center\s*\{[^}]*width:\s*min\(920px,/)
    expect(styles).toMatch(
      /\.settings-center-nav-item\[aria-current="page"\]\s*\{[^}]*color:\s*var\(--primary\)/,
    )
    expect(styles).toMatch(
      /button:not\([\s\S]*\.settings-release-link[\s\S]*\)\s*\{[\s\S]*background:\s*var\(--background\)/,
    )
  })

  it("展示并保存新消息提示音开关", async () => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "新消息通知" }))
    const soundToggle = screen.getByRole("checkbox", { name: "新消息提示音" })
    expect(soundToggle).toBeChecked()

    await user.click(soundToggle)

    expect(bridge.settings.set).toHaveBeenCalledWith({ messageSoundEnabled: false })
    await waitFor(() => expect(soundToggle).not.toBeChecked())
    await waitFor(() => expect(mocks.messageNotificationSoundEnabled?.()).toBe(false))
  })

  it("展示八类设置导航并让存储空间独立可达", async () => {
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))

    for (const label of [
      "通用",
      "新消息通知",
      "外观",
      "存储空间",
      "快捷键",
      "软件更新",
      "工作空间",
      "关于即应",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    }
    await user.click(screen.getByRole("button", { name: "存储空间" }))
    expect(screen.getByRole("heading", { name: "存储空间" })).toBeInTheDocument()
    expect(screen.getByText("应用数据所在磁盘")).toBeInTheDocument()
    expect(screen.getByText("缓存数据")).toBeInTheDocument()
    expect(screen.getByText("其他")).toBeInTheDocument()

    const cacheButton = screen.getByRole("button", { name: "清理本地消息缓存" })
    expect(cacheButton).toHaveClass("settings-secondary-button")

    const source = await readFile(
      path.resolve(process.cwd(), "src/renderer/settings-center.css"),
      "utf8",
    )
    expect(source).toMatch(/\.settings-secondary-button\s*\{[^}]*justify-self:\s*end/)
  })

  it("按勾选项合计并确认清理缓存数据", async () => {
    const bridge = createDesktopBridge()
    const initialStats = {
      appBytes: 9 * 1024,
      cacheItems: [
        { bytes: 2 * 1024, clearable: true, kind: "network" as const },
        { bytes: 3 * 1024, clearable: true, kind: "runtime" as const },
        { bytes: 4 * 1024, clearable: false, kind: "updates" as const },
      ],
      diagnosticsBytes: 512,
      disk: {
        availableBytes: 60 * 1024,
        totalBytes: 100 * 1024,
        usedBytes: 40 * 1024,
      },
      messageCacheBytes: 1024,
      otherBytes: 2 * 1024,
      userDataBytes: 6 * 1024,
    }
    vi.mocked(bridge.storage.getStats).mockResolvedValue(initialStats)
    vi.mocked(bridge.storage.clearCache).mockResolvedValue({
      expectedBytes: 2 * 1024,
      reclaimedBytes: 1536,
      stats: {
        ...initialStats,
        appBytes: 7 * 1024,
        cacheItems: [
          { bytes: 0, clearable: true, kind: "network" },
          { bytes: 3 * 1024, clearable: true, kind: "runtime" },
          { bytes: 4 * 1024, clearable: false, kind: "updates" },
        ],
      },
    })
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "存储空间" }))
    const networkCache = await screen.findByRole("checkbox", { name: "图片、媒体与网络缓存" })
    expect(screen.getByRole("checkbox", { name: "已下载更新" })).toBeDisabled()
    expect(screen.getByText("其他磁盘已用空间")).toBeInTheDocument()
    expect(
      screen.getByRole("img", {
        name: "即应本地数据 9.0 KiB，磁盘已用空间 40.0 KiB，磁盘可用空间 60.0 KiB",
      }),
    ).toBeInTheDocument()

    await user.click(networkCache)

    expect(screen.getByText("已选择 1 项，预计可释放 2.0 KiB")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "清理已选缓存数据" }))

    await waitFor(() => expect(bridge.storage.clearCache).toHaveBeenCalledWith(["network"]))
    expect(screen.getByRole("status")).toHaveTextContent("已清理缓存，实际释放 1.5 KiB")
  })

  it("缓存清理失败后刷新已部分清理的统计", async () => {
    const bridge = createDesktopBridge()
    const initialStats = {
      appBytes: 9 * 1024,
      cacheItems: [
        { bytes: 2 * 1024, clearable: true, kind: "network" as const },
        { bytes: 3 * 1024, clearable: true, kind: "runtime" as const },
        { bytes: 0, clearable: true, kind: "updates" as const },
      ],
      diagnosticsBytes: 0,
      disk: { availableBytes: 60 * 1024, totalBytes: 100 * 1024, usedBytes: 40 * 1024 },
      messageCacheBytes: 0,
      otherBytes: 4 * 1024,
      userDataBytes: 8 * 1024,
    }
    const partiallyClearedStats = {
      ...initialStats,
      appBytes: 7 * 1024,
      cacheItems: [
        { bytes: 0, clearable: true, kind: "network" as const },
        { bytes: 3 * 1024, clearable: true, kind: "runtime" as const },
        { bytes: 0, clearable: true, kind: "updates" as const },
      ],
      userDataBytes: 6 * 1024,
    }
    vi.mocked(bridge.storage.getStats)
      .mockResolvedValueOnce(initialStats)
      .mockResolvedValueOnce(partiallyClearedStats)
    vi.mocked(bridge.storage.clearCache).mockRejectedValueOnce(new Error("运行缓存清理失败"))
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "存储空间" }))
    await user.click(await screen.findByRole("checkbox", { name: "图片、媒体与网络缓存" }))
    await user.click(screen.getByRole("button", { name: "清理已选缓存数据" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("缓存数据清理失败，请重试")
    await waitFor(() => expect(bridge.storage.getStats).toHaveBeenCalledTimes(2))
    expect(screen.getByRole("checkbox", { name: "图片、媒体与网络缓存" })).toBeDisabled()
    expect(screen.getByText("已选择 0 项，预计可释放 0 B")).toBeInTheDocument()
  })

  it("切换语言为 English 后设置界面即时变为英文且不重建工作区宿主", async () => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await waitFor(() => expect(screen.getByRole("heading", { name: "通用" })).toBeInTheDocument())
    const hostInstallCount = mocks.installDesktopFetch.mock.calls.length
    expect(hostInstallCount).toBeGreaterThan(0)

    await chooseSelectOption(user, "语言", "English")

    await waitFor(() => expect(bridge.settings.set).toHaveBeenCalledWith({ language: "en" }))
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Language" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Font size" })).toBeInTheDocument()
    expect(mocks.installDesktopFetch).toHaveBeenCalledTimes(hostInstallCount)
    expect(mocks.restoreFetch).not.toHaveBeenCalled()
  })

  it.each(["win32", "linux"] as const)(
    "%s 英文界面下完整显示发送消息快捷键文案",
    async (platform) => {
      const bridge = createDesktopBridge(undefined, undefined, platform)
      Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
      const user = userEvent.setup()
      render(<DesktopRoot />)

      await user.click(await screen.findByRole("button", { name: "打开设置" }))
      await chooseSelectOption(user, "语言", "English")
      await waitFor(() => expect(screen.getByRole("button", { name: "Shortcuts" })).toBeVisible())
      await user.click(screen.getByRole("button", { name: "Shortcuts" }))

      const picker = await screen.findByRole("combobox", { name: "Send message shortcut" })
      expect(picker).toHaveTextContent("↵ send / Ctrl + ↵ new line")
    },
  )

  it("字体大小设置应用到根元素字号", async () => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await chooseSelectOption(user, "字体大小", "中等 120%")

    await waitFor(() => expect(bridge.settings.set).toHaveBeenCalledWith({ fontScale: "medium" }))
    await waitFor(() => expect(document.documentElement.style.fontSize).toBe("19.2px"))

    await chooseSelectOption(user, "字体大小", "较大 130%")
    await waitFor(() => expect(document.documentElement.style.fontSize).toBe("20.8px"))
  })

  it("桌面端可在原有配色中选择额外色调", async () => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "外观" }))

    await chooseSelectOption(user, "外观", "蓝色")

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-color-theme", "blue"),
    )
    expect(window.localStorage.getItem("theme")).toBe("blue")
    expect(bridge.appearance.setThemeSource).toHaveBeenLastCalledWith("light")
  })

  it("八个分类完整保留全部现有设置能力", async () => {
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await waitFor(() => expect(screen.getByText("v0.1.0")).toBeInTheDocument())
    expect(screen.getByText("开机自动启动")).toBeInTheDocument()
    expect(screen.getByText("关闭窗口")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "新消息通知" }))
    expect(screen.getByText("新消息提示音")).toBeInTheDocument()
    expect(screen.getByText("通知内容")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "外观" }))
    const appearanceSelect = screen.getByRole("combobox", { name: "外观" })
    expect(screen.getByText("配色")).toBeInTheDocument()
    expect(appearanceSelect).toHaveTextContent("跟随系统")
    await user.click(appearanceSelect)
    expect(screen.getByRole("option", { name: "跟随系统" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "浅色" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "深色" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "蓝色" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "紫色" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "玫红" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "琥珀" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "翠绿" })).toBeInTheDocument()
    await user.click(screen.getByRole("option", { name: "深色" }))
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"))

    await user.click(screen.getByRole("button", { name: "存储空间" }))
    expect(screen.getByRole("button", { name: "清理本地消息缓存" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "快捷键" }))
    expect(screen.getByText("截图")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "截图快捷键" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "软件更新" }))
    expect(screen.getByRole("button", { name: "检查更新" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "工作空间" }))
    expect(screen.getByDisplayValue(profile.displayName)).toBeInTheDocument()
    expect(screen.getByText(profile.normalizedUrl)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "移除服务器" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "关于即应" }))
    expect(screen.getByText(/0\.1\.0 · darwin arm64/)).toBeInTheDocument()
    expect(screen.queryByText(/构建/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "导出脱敏诊断" })).toBeInTheDocument()
  })

  it("录制并立即保存新的截图快捷键", async () => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "快捷键" }))
    const recorder = await screen.findByRole("button", { name: "截图快捷键" })
    await waitFor(() => expect(recorder).toHaveTextContent("⌘⇧A"))

    await user.click(recorder)
    await waitFor(() => expect(recorder).toHaveAttribute("aria-pressed", "true"))
    fireEvent.keyDown(recorder, { code: "KeyS", key: "s", metaKey: true, shiftKey: true })

    await waitFor(() =>
      expect(bridge.shortcuts.set).toHaveBeenCalledWith("screenshot", "Command+Shift+S"),
    )
    expect(recorder).toHaveTextContent("⌘⇧S")
  })

  it("发送消息快捷键修复旧值并且只提供两个等宽预设", async () => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    })
    const bridge = createDesktopBridge()
    vi.mocked(bridge.shortcuts.getState).mockImplementation(async (kind) => ({
      accelerator:
        kind === "search"
          ? "CommandOrControl+Shift+F"
          : kind === "sendMessage"
            ? null
            : "CommandOrControl+Shift+A",
      recording: false,
      registered: kind !== "sendMessage",
    }))
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "快捷键" }))

    const picker = await screen.findByRole("combobox", { name: "发送消息快捷键" })
    await waitFor(() => expect(bridge.shortcuts.set).toHaveBeenCalledWith("sendMessage", "Enter"))
    expect(picker).toHaveTextContent("↵ 发送 / ⌘↵ 换行")
    expect(screen.queryByRole("button", { name: "恢复默认发送消息" })).toBeNull()
    expect(picker).toHaveClass("send-message-shortcut-select")
    expect(screen.getByRole("button", { name: "截图快捷键" })).toHaveClass(
      "shortcut-recorder-input",
    )

    picker.focus()
    await user.keyboard("{Enter}")
    const options = await screen.findAllByRole("option")
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent("↵ 发送 / ⌘↵ 换行")
    expect(options[1]).toHaveTextContent("⌘↵ 发送 / ↵ 换行")
    await user.keyboard("{ArrowDown}{Enter}")

    await waitFor(() =>
      expect(bridge.shortcuts.set).toHaveBeenCalledWith("sendMessage", "CommandOrControl+Enter"),
    )

    await user.keyboard("{Enter}{ArrowUp}{Enter}")
    await waitFor(() =>
      expect(bridge.shortcuts.set).toHaveBeenLastCalledWith("sendMessage", "Enter"),
    )
  })

  it("快捷键冲突时显示错误并恢复原组合", async () => {
    const bridge = createDesktopBridge()
    vi.mocked(bridge.shortcuts.set).mockResolvedValueOnce({
      state: {
        accelerator: "CommandOrControl+Shift+A",
        recording: false,
        registered: true,
      },
      status: "conflict",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "快捷键" }))
    const recorder = await screen.findByRole("button", { name: "截图快捷键" })
    await waitFor(() => expect(recorder).toHaveTextContent("⌘⇧A"))
    await user.click(recorder)
    fireEvent.keyDown(recorder, { code: "KeyS", key: "s", metaKey: true, shiftKey: true })

    expect(await screen.findByRole("alert")).toHaveTextContent("该快捷键已被系统或其他应用占用")
    expect(recorder).toHaveTextContent("⌘⇧A")
  })

  it("原快捷键恢复失败时展示准确提示", async () => {
    const bridge = createDesktopBridge()
    vi.mocked(bridge.shortcuts.set).mockResolvedValueOnce({
      state: {
        accelerator: "CommandOrControl+Shift+A",
        recording: false,
        registered: false,
      },
      status: "restore_failed",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "快捷键" }))
    const recorder = await screen.findByRole("button", { name: "截图快捷键" })
    await waitFor(() => expect(recorder).toHaveTextContent("⌘⇧A"))
    await user.click(recorder)
    fireEvent.keyDown(recorder, { code: "KeyS", key: "s", metaKey: true, shiftKey: true })

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "快捷键设置失败，原快捷键也未能恢复，请重新设置",
    )
  })

  it("录制开始请求未返回时关闭设置仍会恢复原快捷键", async () => {
    const bridge = createDesktopBridge()
    const begin = deferred<Awaited<ReturnType<DesktopBridge["shortcuts"]["beginRecording"]>>>()
    vi.mocked(bridge.shortcuts.beginRecording).mockReturnValueOnce(begin.promise)
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "快捷键" }))
    const recorder = await screen.findByRole("button", { name: "截图快捷键" })
    await waitFor(() => expect(recorder).toHaveTextContent("⌘⇧A"))
    await user.click(recorder)
    await user.click(screen.getByRole("button", { name: "关闭设置" }))

    expect(bridge.shortcuts.cancelRecording).toHaveBeenCalledOnce()
    await act(async () =>
      begin.resolve({
        accelerator: "CommandOrControl+Shift+A",
        recording: true,
        registered: false,
      }),
    )
    await waitFor(() => expect(bridge.shortcuts.cancelRecording).toHaveBeenCalledTimes(2))
  })

  it("支持禁用、恢复默认以及取消快捷键录制", async () => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "快捷键" }))
    const recorder = await screen.findByRole("button", { name: "截图快捷键" })
    await waitFor(() => expect(recorder).toHaveTextContent("⌘⇧A"))

    await user.click(screen.getByRole("button", { name: "禁用截图快捷键" }))
    await waitFor(() => expect(bridge.shortcuts.set).toHaveBeenCalledWith("screenshot", null))
    expect(recorder).toHaveTextContent("未设置")

    await user.click(screen.getByRole("button", { name: "恢复默认截图快捷键" }))
    await waitFor(() =>
      expect(bridge.shortcuts.set).toHaveBeenCalledWith("screenshot", "CommandOrControl+Shift+A"),
    )
    expect(recorder).toHaveTextContent("⌘⇧A")

    await user.click(recorder)
    fireEvent.keyDown(recorder, { code: "Escape", key: "Escape" })
    await waitFor(() => expect(bridge.shortcuts.cancelRecording).toHaveBeenCalledOnce())
    await waitFor(() => expect(recorder).toBeEnabled())

    await user.click(recorder)
    await waitFor(() => expect(recorder).toHaveAttribute("aria-pressed", "true"))
    recorder.focus()
    expect(recorder).toHaveFocus()
    fireEvent.focusOut(recorder)
    await waitFor(() => expect(bridge.shortcuts.cancelRecording).toHaveBeenCalledTimes(2))
  })

  it("确认后清理当前账户缓存并刷新统计", async () => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "存储空间" }))
    await user.click(screen.getByRole("button", { name: "清理本地消息缓存" }))

    await waitFor(() => expect(bridge.messageCache.clearUser).toHaveBeenCalledOnce())
    expect(bridge.messageCache.clearUser).toHaveBeenCalledWith({
      id: profile.id,
      normalizedUrl: profile.normalizedUrl,
      userId: profile.lastUserId ?? "anonymous",
    })
    expect(bridge.messageCache.getStats).toHaveBeenCalledTimes(2)
  })

  it("确认后清理实时诊断日志并展示独立的日志大小", async () => {
    const bridge = createDesktopBridge()
    vi.mocked(bridge.diagnostics.getStorageStats).mockResolvedValue({
      bytes: 2 * 1024,
      status: "available",
    })
    vi.mocked(bridge.diagnostics.clearStorage).mockResolvedValue({
      bytes: 0,
      status: "available",
    })
    vi.mocked(bridge.storage.getStats)
      .mockResolvedValueOnce({
        appBytes: 2 * 1024,
        cacheItems: [
          { bytes: 0, clearable: true, kind: "network" },
          { bytes: 0, clearable: true, kind: "runtime" },
          { bytes: 0, clearable: true, kind: "updates" },
        ],
        diagnosticsBytes: 2 * 1024,
        disk: { availableBytes: 0, totalBytes: 0, usedBytes: 0 },
        messageCacheBytes: 0,
        otherBytes: 0,
        userDataBytes: 2 * 1024,
      })
      .mockResolvedValueOnce({
        appBytes: 0,
        cacheItems: [
          { bytes: 0, clearable: true, kind: "network" },
          { bytes: 0, clearable: true, kind: "runtime" },
          { bytes: 0, clearable: true, kind: "updates" },
        ],
        diagnosticsBytes: 0,
        disk: { availableBytes: 0, totalBytes: 0, usedBytes: 0 },
        messageCacheBytes: 0,
        otherBytes: 0,
        userDataBytes: 0,
      })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "存储空间" }))
    expect(await screen.findByText("实时诊断日志")).toBeInTheDocument()
    expect(screen.getByText(/2\.0 KiB/)).toBeInTheDocument()
    expect(screen.queryByText(/保留当前及上一份轮转日志/)).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "清理实时诊断日志" }))

    await waitFor(() => expect(bridge.diagnostics.clearStorage).toHaveBeenCalledOnce())
    expect(bridge.diagnostics.getStorageStats).toHaveBeenCalledOnce()
    expect(screen.getByText("实时诊断日志").parentElement).toHaveTextContent("0 B")
  })

  it("诊断日志清理失败时保留存储页并显示脱敏错误", async () => {
    const bridge = createDesktopBridge()
    vi.mocked(bridge.diagnostics.clearStorage).mockRejectedValueOnce(
      new Error("EACCES: permission denied, diagnostics/realtime.jsonl"),
    )
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "存储空间" }))
    await user.click(screen.getByRole("button", { name: "清理实时诊断日志" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("实时诊断日志清理失败，请重试")
    expect(screen.queryByText(/realtime\.jsonl/)).not.toBeInTheDocument()
    expect(bridge.diagnostics.getStorageStats).toHaveBeenCalledTimes(2)
  })

  it("设置保存失败时保留原值并显示错误", async () => {
    const bridge = createDesktopBridge()
    vi.mocked(bridge.settings.set).mockRejectedValueOnce(
      new Error("EACCES: permission denied, rename '/Users/test/desktop-config.json'"),
    )
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "新消息通知" }))
    const soundToggle = screen.getByRole("checkbox", { name: "新消息提示音" })
    await user.click(soundToggle)

    expect(await screen.findByRole("alert")).toHaveTextContent("设置保存失败，请重试")
    expect(screen.queryByText(/Users\/test/)).not.toBeInTheDocument()
    expect(soundToggle).toBeChecked()
    expect(mocks.messageNotificationSoundEnabled?.()).toBe(true)
  })

  it("发现 OTA 新版本后在左侧栏底部提供图标下载入口", async () => {
    const bridge = createDesktopBridge({
      currentBuild: 1,
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      retryable: true,
      status: "available",
      targetVersion: "1.1.0",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    const updateButton = await screen.findByRole("button", { name: "新版本" })
    expect(updateButton).toHaveAttribute("title", "新版本 · 即应 1.1.0")
    expect(updateButton).toHaveTextContent("新版本")
    expect(screen.getByRole("status")).toHaveTextContent("新版本")
    expect(updateButton.closest("aside")).toHaveAccessibleName("应用侧边栏")
    await user.click(updateButton)

    expect(bridge.updater.download).toHaveBeenCalledOnce()
  })

  it("未配置服务器时仍订阅更新但不展示入口", async () => {
    const bridge = createDesktopBridge({
      currentBuild: 1,
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      retryable: true,
      status: "available",
      targetVersion: "1.1.0",
    })
    vi.mocked(bridge.servers.list).mockResolvedValue([])
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })

    render(<DesktopRoot />)

    expect(await screen.findByRole("heading", { name: "开始使用即应" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "新版本" })).not.toBeInTheDocument()
    expect(bridge.updater.subscribe).toHaveBeenCalledOnce()
    expect(bridge.updater.getState).toHaveBeenCalledOnce()
  })

  it("下载更新时展示进度、禁用重复操作并遵循 reduced-motion", async () => {
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: createDesktopBridge({
        currentBuild: 1,
        currentVersion: "1.0.0",
        installMode: "ota",
        installationSource: "nsis",
        progress: 42.4,
        retryable: false,
        status: "downloading",
        targetVersion: "1.1.0",
      }),
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    const updateButton = await screen.findByRole("button", { name: "下载中 42%" })
    expect(updateButton).toBeEnabled()
    expect(updateButton).toHaveAttribute("aria-disabled", "true")
    expect(updateButton).toHaveTextContent("下载中 42%")
    expect(screen.getByRole("status")).toHaveTextContent("下载中 42%")
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite")
    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true")
    expect(updateButton.querySelector("svg")).toHaveClass("motion-safe:animate-spin")
    expect(updateButton.querySelector("svg")).not.toHaveClass("animate-spin")
    updateButton.focus()
    expect(updateButton).toHaveFocus()
    expect(await screen.findByRole("tooltip")).toHaveTextContent("下载中 42% · 1.1.0")
    await user.click(updateButton)
    expect(window.desktop.updater.download).not.toHaveBeenCalled()
  })

  it("下载进度未知时显示正在下载而不是 0%", async () => {
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: createDesktopBridge({
        currentBuild: 1,
        currentVersion: "1.0.0",
        installMode: "ota",
        installationSource: "nsis",
        retryable: false,
        status: "downloading",
        targetVersion: "1.1.0",
      }),
    })
    render(<DesktopRoot />)

    expect(await screen.findByRole("button", { name: "正在下载" })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
    expect(screen.getByRole("status")).toHaveTextContent("正在下载")
    expect(screen.queryByText("下载中 0%")).not.toBeInTheDocument()
  })

  it("更新状态变化时同步刷新无障碍实时文本", async () => {
    const bridge = createDesktopBridge({
      currentBuild: 1,
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      retryable: true,
      status: "available",
      targetVersion: "1.1.0",
    })
    let publish: ((state: UpdaterState) => void) | undefined
    vi.mocked(bridge.updater.subscribe).mockImplementation((listener) => {
      publish = listener
      return () => undefined
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    render(<DesktopRoot />)

    expect(await screen.findByRole("status")).toHaveTextContent("新版本")

    act(() => {
      publish?.({
        currentBuild: 1,
        currentVersion: "1.0.0",
        installMode: "ota",
        installationSource: "nsis",
        progress: 42.4,
        retryable: false,
        status: "downloading",
        targetVersion: "1.1.0",
      })
    })

    expect(screen.getByRole("status")).toHaveTextContent("下载中 42%")
    expect(screen.getByRole("button", { name: "下载中 42%" })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
  })

  it("下载调用失败时展示可恢复提示", async () => {
    const bridge = createDesktopBridge({
      currentBuild: 1,
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      retryable: true,
      status: "available",
      targetVersion: "1.1.0",
    })
    vi.mocked(bridge.updater.download).mockRejectedValue(new Error("IPC unavailable"))
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "新版本" }))

    expect(await screen.findByText("更新操作失败，请稍后重试")).toBeInTheDocument()
  })

  it("手动升级来源从左下角入口打开匹配的安装包", async () => {
    const bridge = createDesktopBridge({
      currentBuild: 1,
      currentVersion: "1.0.0",
      installMode: "manual",
      installationSource: "deb",
      manualAction: { label: "下载 deb" },
      retryable: false,
      status: "available",
      targetVersion: "1.1.0",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "新版本" }))

    expect(mocks.openManual).toHaveBeenCalledOnce()
    expect(bridge.updater.download).not.toHaveBeenCalled()
  })

  it("更新下载完成后从左下角执行重启安装", async () => {
    const bridge = createDesktopBridge({
      currentBuild: 1,
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      progress: 100,
      retryable: true,
      status: "downloaded",
      targetVersion: "1.1.0",
    })
    vi.mocked(bridge.updater.install).mockResolvedValue({ status: "started" })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "重启更新" }))

    expect(bridge.updater.install).toHaveBeenCalledOnce()
  })

  it("安装被活跃传输阻止时展示准确提示", async () => {
    const bridge = createDesktopBridge({
      currentBuild: 1,
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      progress: 100,
      retryable: true,
      status: "downloaded",
      targetVersion: "1.1.0",
    })
    vi.mocked(bridge.updater.install).mockResolvedValue({
      reason: "active_transfers",
      status: "blocked",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "重启更新" }))

    expect(await screen.findByText("仍有文件正在传输，请完成或取消传输后重试")).toBeInTheDocument()
  })

  it("可重试错误从左下角入口重新检查更新", async () => {
    const bridge = createDesktopBridge({
      currentBuild: 1,
      currentVersion: "1.0.0",
      errorCode: "network",
      installMode: "ota",
      installationSource: "nsis",
      retryable: true,
      status: "error",
      targetVersion: "1.1.0",
    })
    vi.mocked(bridge.updater.check).mockResolvedValue({
      currentBuild: 1,
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      retryable: false,
      status: "idle",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "更新失败" }))

    expect(bridge.updater.check).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "更新失败" })).not.toBeInTheDocument(),
    )
  })

  it("macOS 更新入口同样位于左侧栏底部", async () => {
    const bridge = createDesktopBridge({
      currentBuild: 1,
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "mac_app",
      retryable: true,
      status: "available",
      targetVersion: "1.1.0",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    render(<DesktopRoot />)

    expect(
      (await screen.findByRole("button", { name: "新版本" })).closest("aside"),
    ).toHaveAccessibleName("应用侧边栏")
    expect(bridge.app.info).toHaveBeenCalledOnce()
  })

  it("没有新版本时不显示左下角更新入口", async () => {
    render(<DesktopRoot />)

    await screen.findByRole("button", { name: "打开设置" })
    expect(screen.queryByRole("button", { name: "新版本" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "重启更新" })).not.toBeInTheDocument()
  })

  it("展示实验性更新信息并支持键盘触发手动升级", async () => {
    const bridge = createDesktopBridge({
      currentBuild: 1,
      currentVersion: "1.0.0",
      installMode: "manual",
      installationSource: "deb",
      manualAction: { label: "下载 deb" },
      retryable: false,
      status: "available",
      targetVersion: "1.1.0",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "软件更新" }))
    expect(await screen.findByText("目标版本：1.1.0")).toBeInTheDocument()
    expect(bridge.updater.getState).toHaveBeenCalledOnce()
    expect(screen.getByText("安装来源：Linux deb")).toBeInTheDocument()
    expect(screen.queryByLabelText("更新说明")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "检查更新" }).querySelector(".lucide-refresh-cw"),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "查看发布内容" }))
    expect(mocks.openRelease).toHaveBeenCalledOnce()
    const manual = screen.getByRole("button", { name: "下载 deb" })
    const check = screen.getByRole("button", { name: "检查更新" })
    expect(manual.parentElement).toBe(check.parentElement)
    expect(manual.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    manual.focus()
    await user.keyboard("{Enter}")
    expect(mocks.openManual).toHaveBeenCalledOnce()
  })

  it("设置页捕获更新 Bridge 异常并在操作完成前阻止重复调用", async () => {
    const bridge = createDesktopBridge()
    let rejectCheck: (reason?: unknown) => void = () => undefined
    const checkPromise = new Promise<UpdaterState>((_, reject) => {
      rejectCheck = reject
    })
    vi.mocked(bridge.updater.check).mockReturnValue(checkPromise)
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "软件更新" }))
    const checkButton = await screen.findByRole("button", { name: "检查更新" })
    await user.click(checkButton)

    expect(checkButton).toBeDisabled()
    await user.click(checkButton)
    expect(bridge.updater.check).toHaveBeenCalledOnce()

    await act(async () => rejectCheck(new Error("IPC unavailable")))

    expect(await screen.findByRole("alert")).toHaveTextContent("更新操作失败，请稍后重试")
    await waitFor(() => expect(checkButton).toBeEnabled())
  })

  it("订阅事件先到时不使用较旧的状态快照", async () => {
    const snapshot: UpdaterState = {
      currentBuild: 1,
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "mac_app",
      retryable: false,
      status: "idle",
    }
    const pushedState: UpdaterState = {
      ...snapshot,
      retryable: true,
      status: "available",
      targetVersion: "1.2.0",
    }
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: createDesktopBridge(snapshot, pushedState),
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "软件更新" }))

    expect(await screen.findByText("目标版本：1.2.0")).toBeInTheDocument()
    expect(screen.getByText("发现 1.2.0")).toBeInTheDocument()
    const macGuide = screen.getByText("手动更新 macOS").closest(".desktop-mac-update-guide")
    expect(macGuide).not.toBeNull()
    expect(screen.getByText("退出旧版 MagicChat，下载并打开 DMG")).toBeInTheDocument()
    expect(
      screen.getByText("将即应拖入“应用程序”，再将旧 MagicChat.app 移入废纸篓"),
    ).toBeInTheDocument()
    expect(screen.getByText("打开即应确认数据正常后，再清空废纸篓")).toBeInTheDocument()
    const manualDownload = screen.getByRole("button", { name: "下载 macOS 安装包" })
    const check = screen.getByRole("button", { name: "检查更新" })
    const automaticDownload = screen.getByRole("button", { name: "下载并自动更新" })
    const release = screen.getByRole("button", { name: "查看发布内容" })

    expect(macGuide).toContainElement(manualDownload)
    expect(screen.getByText("目标版本：1.2.0").parentElement).toContainElement(release)
    expect(check.parentElement).toBe(automaticDownload.parentElement)
    expect(
      check.compareDocumentPosition(automaticDownload) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    await user.click(manualDownload)
    expect(mocks.openManual).toHaveBeenCalledOnce()
  })

  it("macOS 自动安装受限时展示友好的手动更新路径", async () => {
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: createDesktopBridge({
        currentBuild: 1,
        currentVersion: "1.0.0",
        errorCode: "platform_signature_required",
        installMode: "ota",
        installationSource: "mac_app",
        retryable: true,
        status: "error",
        targetVersion: "1.1.0",
      }),
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "软件更新" }))

    expect(
      await screen.findByText("自动安装受 macOS 安全策略限制，请使用安装包手动更新"),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "下载 macOS 安装包" })).toBeInTheDocument()
  })

  it("安装器未能启动时展示准确的恢复提示", async () => {
    const bridge = createDesktopBridge({
      currentBuild: 1,
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      progress: 100,
      retryable: true,
      status: "downloaded",
      targetVersion: "1.1.0",
    })
    vi.mocked(bridge.updater.install).mockResolvedValue({
      reason: "install_failed",
      status: "failed",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "软件更新" }))
    await user.click(screen.getByRole("button", { name: "安装并重启" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "自动安装未能启动，请重试检查或使用手动更新",
    )
  })

  it("直接使用系统浏览器打开 HTTPS 外链", async () => {
    render(<DesktopRoot />)
    await screen.findByRole("button", { name: "打开设置" })

    act(() => mocks.externalLinkHandler?.("https://example.com/docs"))

    await waitFor(() =>
      expect(mocks.shellOpenExternal).toHaveBeenCalledWith("https://example.com/docs"),
    )
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("确认后才使用系统浏览器打开 HTTP 外链", async () => {
    const user = userEvent.setup()
    render(<DesktopRoot />)
    await screen.findByRole("button", { name: "打开设置" })

    act(() => mocks.externalLinkHandler?.("http://intranet.example.test/docs"))

    expect(
      await screen.findByRole("alertdialog", { name: "打开不安全的 HTTP 链接？" }),
    ).toBeVisible()
    expect(mocks.shellOpenExternal).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "继续打开" }))

    expect(mocks.shellOpenExternal).toHaveBeenCalledWith("http://intranet.example.test/docs")
  })

  it("从宿主外链入口直接打开当前 Server 的文档窗口", async () => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    render(<DesktopRoot />)
    await screen.findByRole("button", { name: "打开设置" })

    await act(() => mocks.hostOpenExternal?.(documentUrl))

    expect(bridge.navigation.openDocumentWindow).toHaveBeenCalledWith(
      documentId,
      profile.id,
      "document",
    )
    expect(mocks.shellOpenExternal).not.toHaveBeenCalled()
  })

  it("从捕获式锚点入口直接打开当前 Server 的文档窗口", async () => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    render(<DesktopRoot />)
    await screen.findByRole("button", { name: "打开设置" })

    act(() => mocks.externalLinkHandler?.(documentUrl))

    await waitFor(() =>
      expect(bridge.navigation.openDocumentWindow).toHaveBeenCalledWith(
        documentId,
        profile.id,
        "document",
      ),
    )
    expect(mocks.shellOpenExternal).not.toHaveBeenCalled()
  })

  it("重复点击同一文档继续交给幂等窗口管理器且不打开浏览器", async () => {
    const bridge = createDesktopBridge()
    vi.mocked(bridge.navigation.openDocumentWindow)
      .mockResolvedValueOnce({ ok: true, result: { status: "created" } })
      .mockResolvedValueOnce({ ok: true, result: { status: "focused" } })
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    render(<DesktopRoot />)
    await screen.findByRole("button", { name: "打开设置" })

    await act(() => mocks.hostOpenExternal?.(documentUrl))
    await act(() => mocks.hostOpenExternal?.(documentUrl))

    expect(bridge.navigation.openDocumentWindow).toHaveBeenCalledTimes(2)
    expect(bridge.navigation.openDocumentWindow).toHaveBeenNthCalledWith(
      1,
      documentId,
      profile.id,
      "document",
    )
    expect(bridge.navigation.openDocumentWindow).toHaveBeenNthCalledWith(
      2,
      documentId,
      profile.id,
      "document",
    )
    expect(mocks.shellOpenExternal).not.toHaveBeenCalled()
  })

  it.each([
    ["not_authenticated", "当前服务器登录状态已失效，请重新登录后重试。"],
    ["target_mismatch", "文档窗口认证目标已变化，请从当前服务器重新打开。"],
    ["window_limit", "同一服务器最多打开 8 个文档窗口，请先关闭已有窗口。"],
    ["load_failed", "文档窗口加载失败，请重试。"],
    ["disposed", "应用正在退出，请稍后重试。"],
  ] as const)("文档交接失败 %s 时显示稳定反馈且不回退浏览器", async (code, message) => {
    const bridge = createDesktopBridge()
    vi.mocked(bridge.navigation.openDocumentWindow).mockResolvedValue({
      error: { code, message: "不应直接展示底层错误" },
      ok: false,
    })
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    render(<DesktopRoot />)
    await screen.findByRole("button", { name: "打开设置" })

    act(() => mocks.externalLinkHandler?.(documentUrl))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(mocks.shellOpenExternal).not.toHaveBeenCalled()
  })

  it("Bridge 不可用时显示稳定反馈且不泄露底层错误", async () => {
    const bridge = createDesktopBridge()
    vi.mocked(bridge.navigation.openDocumentWindow).mockRejectedValue(
      new Error("包含敏感上下文的底层错误"),
    )
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    render(<DesktopRoot />)
    await screen.findByRole("button", { name: "打开设置" })

    act(() => mocks.externalLinkHandler?.(documentUrl))

    expect(await screen.findByText("文档窗口服务暂不可用，请稍后重试。")).toBeInTheDocument()
    expect(screen.queryByText("包含敏感上下文的底层错误")).not.toBeInTheDocument()
    expect(mocks.shellOpenExternal).not.toHaveBeenCalled()
  })

  it.each([
    `https://other.example.com/documents/document/${documentId}`,
    `${profile.normalizedUrl}/projects/project-1/documents`,
    `${profile.normalizedUrl}/documents/document/not-a-uuid`,
  ])("未识别的 HTTPS 链接继续使用系统浏览器：%s", async (url) => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    render(<DesktopRoot />)
    await screen.findByRole("button", { name: "打开设置" })

    await act(() => mocks.hostOpenExternal?.(url))

    expect(mocks.shellOpenExternal).toHaveBeenCalledWith(url)
    expect(bridge.navigation.openDocumentWindow).not.toHaveBeenCalled()
  })

  it("非法协议继续被统一外链入口拒绝", async () => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", { configurable: true, value: bridge })
    render(<DesktopRoot />)
    await screen.findByRole("button", { name: "打开设置" })

    await expect(mocks.hostOpenExternal?.("file:///etc/passwd")).rejects.toThrow(
      "只允许打开 HTTP 或 HTTPS 外部链接",
    )
    expect(mocks.shellOpenExternal).not.toHaveBeenCalled()
    expect(bridge.navigation.openDocumentWindow).not.toHaveBeenCalled()
  })
})

describe("发布通道显示", () => {
  it.each(["test", "preview", "stable"] as const)("将 %s 映射到翻译键", (channel) => {
    expect(releaseChannelLabel(channel, (key) => key)).toBe(`settings.release.${channel}`)
  })
})

async function chooseSelectOption(
  user: { click(element: Element): Promise<void> },
  label: string,
  option: string,
) {
  await user.click(screen.getByRole("combobox", { name: label }))
  await user.click(await screen.findByRole("option", { name: option }))
}

function createDesktopBridge(
  updaterState?: UpdaterState,
  subscriptionState?: UpdaterState,
  platform = "darwin",
): DesktopBridge {
  const unsubscribe = () => undefined
  const initialUpdaterState: UpdaterState = updaterState ?? {
    currentBuild: 0,
    currentVersion: "0.1.0",
    installMode: "manual",
    installationSource: "development",
    retryable: false,
    status: "manual",
  }
  let settings = {
    autoLaunch: false,
    closeBehavior: "background" as const,
    fontScale: "normal" as const,
    language: "zh-CN" as const,
    messageNotificationsEnabled: true,
    messageSoundEnabled: true,
    notificationPrivacy: "metadata" as const,
    screenshotShortcut: "CommandOrControl+Shift+A",
    searchShortcut: "CommandOrControl+Shift+F",
    sendMessageShortcut: "Enter",
    selectedServerId: profile.id,
  }
  return {
    asr: {
      close: vi.fn(),
      commit: vi.fn(),
      connect: vi.fn(),
      sendFrame: vi.fn(),
      subscribe: vi.fn().mockReturnValue(unsubscribe),
    },
    app: {
      info: vi.fn().mockResolvedValue({
        arch: "arm64",
        build: "test",
        channel: "test",
        packaged: false,
        platform,
        version: "0.1.0",
      }),
    },
    appearance: { setThemeSource: vi.fn().mockResolvedValue(undefined) },
    auth: {
      cancel: vi.fn(),
      start: vi.fn(),
      subscribeFinished: vi.fn().mockReturnValue(unsubscribe),
    },
    badge: { set: vi.fn() },
    tray: { setMessages: vi.fn() },
    clipboard: { writePng: vi.fn(), writeText: vi.fn() },
    diagnostics: {
      clearStorage: vi.fn().mockResolvedValue({ bytes: 0, status: "available" }),
      export: vi.fn(),
      getStorageStats: vi.fn().mockResolvedValue({ bytes: 0, status: "available" }),
      record: vi.fn(),
      reportRuntime: vi.fn(),
    },
    documentCollaboration: {
      cancel: vi.fn(),
      close: vi.fn(),
      connect: vi.fn(),
      send: vi.fn(),
      subscribe: vi.fn().mockReturnValue(unsubscribe),
    },
    files: {
      download: vi.fn(),
      openLocation: vi.fn(),
      pick: vi.fn(),
      upload: vi.fn(),
    },
    messageCache: {
      clearConversation: vi.fn(),
      clearUser: vi.fn(),
      commitAfter: vi.fn(),
      commitBefore: vi.fn(),
      commitLatest: vi.fn(),
      getById: vi.fn(),
      getStats: vi.fn().mockResolvedValue({
        conversationCount: 0,
        messageCount: 0,
        payloadBytes: 0,
        status: "available",
      }),
      getSyncState: vi.fn(),
      listSyncStates: vi.fn(),
      readAround: vi.fn(),
      readBefore: vi.fn(),
      readRecent: vi.fn(),
      removeMessage: vi.fn(),
      upsert: vi.fn(),
    },
    navigation: {
      openDocumentWindow: vi.fn().mockResolvedValue({
        ok: true,
        result: { status: "created" },
      }),
      subscribe: vi.fn().mockReturnValue(unsubscribe),
      subscribeUnknownServer: vi.fn().mockReturnValue(unsubscribe),
    },
    notifications: { show: vi.fn() },
    permissions: { openSettings: vi.fn(), request: vi.fn() },
    realtime: {
      close: vi.fn(),
      connect: vi.fn(),
      send: vi.fn(),
      subscribe: vi.fn().mockReturnValue(unsubscribe),
      subscribeSnapshot: vi.fn().mockReturnValue(unsubscribe),
      subscribeUnauthorized: vi.fn().mockReturnValue(unsubscribe),
    },
    screenshot: {
      start: vi.fn(),
      subscribeCompleted: vi.fn().mockReturnValue(unsubscribe),
      subscribeStartFailed: vi.fn().mockImplementation((listener) => {
        mocks.screenshotStartFailureSubscriber = listener
        return mocks.screenshotStartFailureUnsubscribe
      }),
    },
    shortcuts: {
      beginRecording: vi.fn().mockResolvedValue({
        accelerator: "CommandOrControl+Shift+A",
        recording: true,
        registered: false,
      }),
      cancelRecording: vi.fn().mockResolvedValue({
        accelerator: "CommandOrControl+Shift+A",
        recording: false,
        registered: true,
      }),
      getState: vi.fn().mockImplementation(async (kind: string) => ({
        accelerator:
          kind === "search"
            ? "CommandOrControl+Shift+F"
            : kind === "sendMessage"
              ? settings.sendMessageShortcut
              : "CommandOrControl+Shift+A",
        recording: false,
        registered: kind !== "sendMessage",
      })),
      set: vi.fn().mockImplementation(async (_kind: string, accelerator: string | null) => ({
        state: { accelerator, recording: false, registered: accelerator !== null },
        status: "updated",
      })),
      subscribeSearchOpen: vi.fn().mockReturnValue(vi.fn()),
    },
    servers: {
      add: vi.fn(),
      list: vi.fn().mockResolvedValue([profile]),
      remove: mocks.remove,
      rename: vi.fn(),
      select: vi.fn(),
    },
    settings: {
      get: vi.fn().mockImplementation(async () => ({ ...settings })),
      set: vi.fn().mockImplementation(async (patch) => {
        settings = { ...settings, ...patch }
        return { ...settings }
      }),
    },
    storage: {
      clearCache: vi.fn(),
      getStats: vi.fn().mockResolvedValue({
        appBytes: 0,
        cacheItems: [
          { bytes: 0, clearable: true, kind: "network" },
          { bytes: 0, clearable: true, kind: "runtime" },
          { bytes: 0, clearable: true, kind: "updates" },
        ],
        diagnosticsBytes: 0,
        disk: { availableBytes: 0, totalBytes: 0, usedBytes: 0 },
        messageCacheBytes: 0,
        otherBytes: 0,
        userDataBytes: 0,
      }),
    },
    shell: { openExternal: mocks.shellOpenExternal },
    transport: {
      cancel: vi.fn(),
      request: vi.fn(),
      streamAbort: vi.fn(),
      streamChunk: vi.fn(),
      streamFinish: vi.fn(),
      streamStart: vi.fn(),
    },
    updater: {
      cancelDownload: vi.fn().mockResolvedValue(initialUpdaterState),
      check: vi.fn(),
      download: vi.fn(),
      getState: vi.fn().mockResolvedValue(initialUpdaterState),
      install: vi.fn(),
      openManualDownload: mocks.openManual,
      openReleasePage: mocks.openRelease,
      subscribe: vi.fn((listener) => {
        if (subscriptionState) listener(subscriptionState)
        return unsubscribe
      }),
    },
    version: 1,
  }
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}
