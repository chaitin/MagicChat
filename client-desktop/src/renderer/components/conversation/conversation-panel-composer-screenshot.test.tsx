import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  ScreenshotConversationResult,
  ScreenshotStartResult,
} from "@shared/screenshot-contract"
import type { ClientConversation } from "@/lib/client-data-api"

const mocks = vi.hoisted(() => ({
  compressImage: vi.fn(async (file: File) => file),
  openPermissionSettings: vi.fn(),
  screenshotStart: vi.fn(),
  screenshotSubscriber: undefined as ((result: ScreenshotConversationResult) => void) | undefined,
  settingsGet: vi.fn(),
  toastDismiss: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: {
    dismiss: mocks.toastDismiss,
    error: mocks.toastError,
    warning: mocks.toastWarning,
  },
}))
vi.mock("@/lib/image-message", () => ({
  compressImageForMessage: mocks.compressImage,
  imageMessageMaxBytes: 2 * 1024 * 1024,
  isAcceptedImageMessageFile: (file: File) => file.type.startsWith("image/"),
}))
vi.mock("@/components/expression-picker-popover", () => ({
  ExpressionPickerPopover: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock("@/components/send-image-message-dialog", () => ({
  SendImageMessageDialog: ({ image, open }: { image: File | null; open: boolean }) =>
    open ? <div role="dialog">{image?.name}</div> : null,
}))
vi.mock("@/components/send-file-message-dialog", () => ({
  SendFileMessageDialog: () => null,
}))
vi.mock("@/components/conversation/send-voice-message-dialog", () => ({
  SendVoiceMessageDialog: () => null,
}))
vi.mock("@/components/conversation/smart-voice-input-dialog", () => ({
  SmartVoiceInputDialog: () => null,
}))
vi.mock("@/components/conversation/conversation-voice-menu", () => ({
  ConversationVoiceMenu: () => null,
}))

import { ConversationPanelComposer } from "./conversation-panel-composer"

describe("ConversationPanelComposer 截图", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.screenshotSubscriber = undefined
    mocks.openPermissionSettings.mockResolvedValue(true)
    mocks.screenshotStart.mockResolvedValue({ sessionId: "session-1", status: "started" })
    mocks.settingsGet.mockResolvedValue({
      autoLaunch: false,
      closeBehavior: "background",
      messageSoundEnabled: true,
      notificationPrivacy: "metadata",
      screenshotShortcut: "CommandOrControl+Shift+A",
      searchShortcut: "CommandOrControl+Shift+F",
      sendMessageShortcut: null,
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        permissions: {
          openSettings: mocks.openPermissionSettings,
        },
        screenshot: {
          start: mocks.screenshotStart,
          subscribeCompleted: (listener: (result: ScreenshotConversationResult) => void) => {
            mocks.screenshotSubscriber = listener
            return mocks.unsubscribe
          },
        },
        settings: {
          get: mocks.settingsGet,
        },
      },
    })
  })

  it("以当前对话启动截图，并把匹配的 PNG 接入图片准备流程", async () => {
    const user = userEvent.setup()
    const resultBlob = new Blob([new Uint8Array([1])], { type: "image/png" })
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ blob: async () => resultBlob, ok: true } as Response)
    const { unmount } = renderComposer()

    await user.click(screen.getByRole("button", { name: "截取屏幕" }))

    expect(mocks.screenshotStart).toHaveBeenCalledWith({ conversationId: "conversation-1" })
    expect(mocks.toastDismiss).toHaveBeenCalledWith("screenshot-screen-permission-required")
    expect(mocks.screenshotSubscriber).toBeTypeOf("function")

    act(() => {
      mocks.screenshotSubscriber?.({
        conversationId: "conversation-other",
        fileName: "ignored.png",
        resourceUrl: "magicchat-capture://result/session/ignored",
        sessionId: "session-other",
      })
    })
    expect(fetchMock).not.toHaveBeenCalled()

    act(() => {
      mocks.screenshotSubscriber?.({
        conversationId: "conversation-1",
        fileName: "capture.png",
        resourceUrl: "magicchat-capture://result/session/token",
        sessionId: "session-1",
      })
    })

    await waitFor(() => expect(mocks.compressImage).toHaveBeenCalledOnce())
    expect(await screen.findByRole("dialog")).toHaveTextContent("capture.png")
    unmount()
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  })

  it("展示稳定的截图启动错误", async () => {
    mocks.screenshotStart.mockResolvedValue({ code: "permission_denied", status: "error" })
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByRole("button", { name: "截取屏幕" }))

    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "截图需要屏幕录制权限，请前往“系统设置 > 隐私与安全性 > 屏幕录制”允许即应",
      expect.objectContaining({
        action: expect.objectContaining({ label: "前往设置" }),
        closeButton: true,
        duration: Infinity,
        id: "screenshot-screen-permission-required",
      }),
    )

    const options = mocks.toastWarning.mock.calls[0][1] as {
      action: { onClick(event: { preventDefault(): void }): void }
    }
    const preventDefault = vi.fn()
    options.action.onClick({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(mocks.openPermissionSettings).toHaveBeenCalledWith("screen")
  })

  it("权限恢复后遇到其他截图错误时清除旧权限提示", async () => {
    mocks.screenshotStart.mockResolvedValue({ code: "capture_timeout", status: "error" })
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByRole("button", { name: "截取屏幕" }))

    expect(mocks.toastDismiss).toHaveBeenCalledWith("screenshot-screen-permission-required")
    expect(mocks.toastError).toHaveBeenCalledWith("屏幕截图响应超时，请重试")
  })

  it("截图启动异常时清除旧权限提示", async () => {
    mocks.screenshotStart.mockRejectedValue(new Error("IPC failed"))
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByRole("button", { name: "截取屏幕" }))

    expect(mocks.toastDismiss).toHaveBeenCalledWith("screenshot-screen-permission-required")
    expect(mocks.toastError).toHaveBeenCalledWith("无法启动截图")
  })

  it("启动截图期间保持静态截图图标并拦截重复触发", async () => {
    let resolveStart!: (result: ScreenshotStartResult) => void
    mocks.screenshotStart.mockImplementation(
      () =>
        new Promise<ScreenshotStartResult>((resolve) => {
          resolveStart = resolve
        }),
    )
    const user = userEvent.setup()
    renderComposer()
    const screenshotButton = screen.getByRole("button", { name: "截取屏幕" })

    await user.click(screenshotButton)

    expect(screenshotButton).toBeEnabled()
    expect(screenshotButton.querySelector(".lucide-scan-line")).not.toBeNull()
    expect(screenshotButton.querySelector(".animate-spin")).toBeNull()

    await user.click(screenshotButton)
    expect(mocks.screenshotStart).toHaveBeenCalledOnce()

    await act(async () => {
      resolveStart({ sessionId: "session-1", status: "started" })
    })
  })

  it("把编辑区和全部操作按钮组合在同一个输入组内", () => {
    renderComposer()

    const textarea = screen.getByPlaceholderText("输入消息")
    const inputGroup = textarea.closest('[data-slot="input-group"]')
    const toolbar = screen.getByTestId("conversation-panel-toolbar-row")

    expect(inputGroup).not.toBeNull()
    expect(inputGroup).toContainElement(toolbar)
    expect(toolbar).toHaveAttribute("data-align", "block-end")
    expect(screen.getByRole("button", { name: "发送消息" })).toHaveAttribute("data-size", "sm")
  })

  it("切换对话时取消未完成的截图读取并忽略旧结果", async () => {
    let fetchSignal: AbortSignal | undefined
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((resolve) => {
          fetchSignal = init?.signal ?? undefined
          resolveFetch = resolve
        }),
    )
    const view = renderComposer()

    act(() => {
      mocks.screenshotSubscriber?.({
        conversationId: "conversation-1",
        fileName: "stale.png",
        resourceUrl: "magicchat-capture://result/session/stale",
        sessionId: "session-1",
      })
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

    view.rerender(composerElement({ ...conversation, id: "conversation-2" }))
    expect(fetchSignal?.aborted).toBe(true)

    await act(async () => {
      resolveFetch({
        blob: async () => new Blob([new Uint8Array([1])], { type: "image/png" }),
        ok: true,
      } as Response)
      await Promise.resolve()
    })

    expect(mocks.compressImage).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("Enter 发送预设下普通 Enter 发送，Cmd/Ctrl+Enter 和 Shift+Enter 换行", async () => {
    const user = userEvent.setup()
    const onSendMessage = vi.fn()
    const onDraftChange = vi.fn()
    render(composerElement(conversation, { draft: "你好", onDraftChange, onSendMessage }))

    const input = screen.getByPlaceholderText("输入消息")
    await user.click(input)
    await user.keyboard("{Enter}")
    expect(onSendMessage).toHaveBeenCalledWith("你好")

    onSendMessage.mockClear()
    await user.keyboard("{Meta>}{Enter}{/Meta}")
    expect(onSendMessage).not.toHaveBeenCalled()

    await user.keyboard("{Control>}{Enter}{/Control}")
    expect(onSendMessage).not.toHaveBeenCalled()

    await user.keyboard("{Shift>}{Enter}{/Shift}")
    expect(onSendMessage).not.toHaveBeenCalled()
    expect(onDraftChange).toHaveBeenCalled()
  })

  it("Cmd/Ctrl+Enter 发送预设下组合键发送，普通 Enter 换行", async () => {
    mocks.settingsGet.mockResolvedValue({
      autoLaunch: false,
      closeBehavior: "background",
      messageSoundEnabled: true,
      notificationPrivacy: "metadata",
      screenshotShortcut: "CommandOrControl+Shift+A",
      searchShortcut: "CommandOrControl+Shift+F",
      sendMessageShortcut: "CommandOrControl+Enter",
    })
    const user = userEvent.setup()
    const onDraftChange = vi.fn()
    const onSendMessage = vi.fn()
    render(composerElement(conversation, { draft: "你好", onDraftChange, onSendMessage }))

    const input = screen.getByPlaceholderText("输入消息")
    await user.click(input)
    await user.keyboard("{Enter}")
    expect(onSendMessage).not.toHaveBeenCalled()
    expect(onDraftChange).toHaveBeenCalled()

    await user.keyboard("{Meta>}{Enter}{/Meta}")
    expect(onSendMessage).toHaveBeenCalledWith("你好")
  })

  it("发送时立即清空草稿，成功后保留发送期间的新输入", async () => {
    const user = userEvent.setup()
    const pending = deferred<boolean>()
    const onSendMessage = vi.fn(() => pending.promise)
    render(<ControlledComposer initialDraft="第一条" onSendMessage={onSendMessage} />)

    const input = screen.getByPlaceholderText("输入消息")
    await user.click(input)
    await user.keyboard("{Enter}")

    expect(onSendMessage).toHaveBeenCalledWith("第一条")
    expect(input).toHaveValue("")

    await user.type(input, "第二条")
    pending.resolve(true)

    await waitFor(() => expect(input).toHaveValue("第二条"))
  })

  it("发送失败时恢复原草稿，并阻止请求完成前重复发送", async () => {
    const user = userEvent.setup()
    const pending = deferred<boolean>()
    const onSendMessage = vi.fn(() => pending.promise)
    render(<ControlledComposer initialDraft="待重试" onSendMessage={onSendMessage} />)

    const input = screen.getByPlaceholderText("输入消息")
    await user.click(input)
    await user.keyboard("{Enter}{Enter}")

    expect(onSendMessage).toHaveBeenCalledOnce()
    expect(input).toHaveValue("")

    pending.resolve(false)

    await waitFor(() => expect(input).toHaveValue("待重试"))
  })
})

function ControlledComposer({
  initialDraft,
  onSendMessage,
}: {
  initialDraft: string
  onSendMessage: (content?: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(initialDraft)
  return composerElement(conversation, { draft, onDraftChange: setDraft, onSendMessage })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function renderComposer() {
  return render(composerElement(conversation))
}

function composerElement(
  currentConversation: ClientConversation,
  {
    draft = "",
    onDraftChange = vi.fn(),
    onSendMessage = vi.fn(),
  }: {
    draft?: string
    onDraftChange?: (draft: string) => void
    onSendMessage?: (content?: string) => Promise<boolean>
  } = {},
) {
  return (
    <ConversationPanelComposer
      conversation={currentConversation}
      draft={draft}
      draftMentions={[]}
      onCancelReply={vi.fn()}
      onDraftChange={onDraftChange}
      onRichTextModeChange={vi.fn()}
      onSendFile={vi.fn().mockResolvedValue(null)}
      onSendImage={vi.fn().mockResolvedValue(null)}
      onSendMessage={onSendMessage}
      onSendVoice={vi.fn().mockResolvedValue(null)}
      replyTarget={null}
      richTextMode={false}
      sending={false}
    />
  )
}

const conversation: ClientConversation = {
  avatar: "",
  createdAt: "2026-07-31T00:00:00Z",
  id: "conversation-1",
  lastMessageAt: null,
  lastMessageId: null,
  lastMessageSeq: 0,
  lastMessageSummary: "",
  lastChoiceSeq: 0,
  lastMentionedSeq: 0,
  lastReadSeq: 0,
  memberCount: 1,
  members: [],
  name: "截图测试",
  type: "direct",
  unreadCount: 0,
  visibility: "private",
}
