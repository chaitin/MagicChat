import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { expect, it, vi } from "vitest"

import { ConversationPanelComposer } from "@/components/conversation/conversation-panel-composer"
import type { ClientConversation } from "@/lib/client-data-api"

it("allows Enter text sending while an attachment send is in progress", () => {
  const onSendMessage = vi.fn(async () => true)

  render(
    <MemoryRouter>
      <ConversationPanelComposer
        conversation={conversation}
        draft="继续发送"
        draftMentions={[]}
        onCancelReply={vi.fn()}
        onDraftChange={vi.fn()}
        onRichTextModeChange={vi.fn()}
        onSendFile={async () => null}
        onSendImage={async () => null}
        onSendMessage={onSendMessage}
        onSendVoice={async () => null}
        replyTarget={null}
        richTextMode={false}
        sending
      />
    </MemoryRouter>
  )

  const editor = screen.getByPlaceholderText("输入消息")
  expect(editor).not.toHaveAttribute("readonly")
  fireEvent.keyDown(editor, { key: "Enter" })

  expect(onSendMessage).toHaveBeenCalledWith("继续发送")
  expect(screen.getByRole("button", { name: "上传文件" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled()
})

it("selects a video and sends it with a caption", async () => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:video-preview"),
  })
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  })
  const onSendVideo = vi.fn(async () => null)
  const { container } = render(
    <MemoryRouter>
      <ConversationPanelComposer
        conversation={conversation}
        draft=""
        draftMentions={[]}
        onCancelReply={vi.fn()}
        onDraftChange={vi.fn()}
        onRichTextModeChange={vi.fn()}
        onSendFile={async () => null}
        onSendImage={async () => null}
        onSendMessage={async () => true}
        onSendVideo={onSendVideo}
        onSendVoice={async () => null}
        replyTarget={null}
        richTextMode={false}
        sending={false}
      />
    </MemoryRouter>
  )

  expect(screen.getByRole("button", { name: "插入视频" })).toBeEnabled()
  const input = container.querySelector<HTMLInputElement>(
    'input[accept="video/mp4,video/webm"]'
  )!
  const video = new File(["video"], "demo.mp4", { type: "video/mp4" })
  fireEvent.change(input, { target: { files: [video] } })
  fireEvent.change(await screen.findByLabelText("视频说明"), {
    target: { value: "演示视频" },
  })
  fireEvent.click(screen.getByRole("button", { name: "发送" }))

  await waitFor(() =>
    expect(onSendVideo).toHaveBeenCalledWith(video, "演示视频", "text")
  )
})

it("keeps typing local and synchronizes on debounce, blur, send, and switch", async () => {
  vi.useFakeTimers()
  const onDraftChange = vi.fn()
  const onSendMessage = vi.fn(async () => true)
  const props = {
    conversation,
    draft: "",
    draftMentions: [],
    onCancelReply: vi.fn(),
    onDraftChange,
    onRichTextModeChange: vi.fn(),
    onSendFile: async () => null,
    onSendImage: async () => null,
    onSendMessage,
    onSendVoice: async () => null,
    replyTarget: null,
    richTextMode: false,
    sending: false,
  }
  const { rerender } = render(
    <MemoryRouter>
      <ConversationPanelComposer {...props} />
    </MemoryRouter>
  )
  const editor = screen.getByPlaceholderText("输入消息")

  fireEvent.change(editor, { target: { value: "连续按键" } })
  expect(editor).toHaveValue("连续按键")
  expect(onDraftChange).not.toHaveBeenCalled()
  vi.advanceTimersByTime(399)
  expect(onDraftChange).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(onDraftChange).toHaveBeenLastCalledWith("连续按键", [])

  onDraftChange.mockClear()
  fireEvent.change(editor, { target: { value: "失焦保存" } })
  fireEvent.blur(editor)
  expect(onDraftChange).toHaveBeenCalledTimes(1)
  expect(onDraftChange).toHaveBeenLastCalledWith("失焦保存", [])

  onDraftChange.mockClear()
  fireEvent.change(editor, { target: { value: "立即发送" } })
  fireEvent.keyDown(editor, { key: "Enter" })
  expect(onDraftChange).toHaveBeenCalledWith("立即发送", [])
  expect(onSendMessage).toHaveBeenCalledWith("立即发送")
  await vi.runAllTimersAsync()
  expect(editor).toHaveValue("")

  fireEvent.change(editor, { target: { value: "旧会话" } })
  rerender(
    <MemoryRouter>
      <ConversationPanelComposer
        {...props}
        conversation={{ ...conversation, id: "conversation-2" }}
        draft="新会话草稿"
      />
    </MemoryRouter>
  )
  expect(onDraftChange).toHaveBeenLastCalledWith("旧会话", [])
  expect(editor).toHaveValue("新会话草稿")
  vi.useRealTimers()
})

it("adopts real same-conversation external drafts but ignores its own echo", () => {
  const props = {
    conversation,
    draft: "原稿",
    draftMentions: [],
    onCancelReply: vi.fn(),
    onDraftChange: vi.fn(),
    onRichTextModeChange: vi.fn(),
    onSendFile: async () => null,
    onSendImage: async () => null,
    onSendMessage: async () => true,
    onSendVoice: async () => null,
    replyTarget: null,
    richTextMode: false,
    sending: false,
  }
  const { rerender } = render(
    <MemoryRouter>
      <ConversationPanelComposer {...props} />
    </MemoryRouter>
  )
  const editor = screen.getByPlaceholderText("输入消息")
  fireEvent.change(editor, { target: { value: "本地输入" } })
  rerender(
    <MemoryRouter>
      <ConversationPanelComposer {...props} />
    </MemoryRouter>
  )
  expect(editor).toHaveValue("本地输入")

  rerender(
    <MemoryRouter>
      <ConversationPanelComposer {...props} draft="撤回后重新编辑" />
    </MemoryRouter>
  )
  expect(editor).toHaveValue("撤回后重新编辑")
})

it("clears the submitted text immediately without clearing new input", async () => {
  let resolve!: (accepted: boolean) => void
  const onDraftChange = vi.fn()
  const onSendMessage = vi.fn(
    () =>
      new Promise<boolean>((done) => {
        resolve = done
      })
  )
  render(
    <MemoryRouter>
      <ConversationPanelComposer
        conversation={conversation}
        draft="第一条"
        draftMentions={[]}
        onCancelReply={vi.fn()}
        onDraftChange={onDraftChange}
        onRichTextModeChange={vi.fn()}
        onSendFile={async () => null}
        onSendImage={async () => null}
        onSendMessage={onSendMessage}
        onSendVoice={async () => null}
        replyTarget={null}
        richTextMode={false}
        sending={false}
      />
    </MemoryRouter>
  )
  const editor = screen.getByPlaceholderText("输入消息")

  fireEvent.keyDown(editor, { key: "Enter" })
  expect(editor).toHaveValue("")
  expect(onDraftChange).toHaveBeenLastCalledWith("", [])

  fireEvent.change(editor, { target: { value: "第二条" } })
  expect(editor).toHaveValue("第二条")
  resolve(true)
  await Promise.resolve()
  expect(editor).toHaveValue("第二条")
})

it("retains a rejected send and prevents rapid duplicate sends", async () => {
  let resolve!: (accepted: boolean) => void
  const onSendMessage = vi.fn(
    () =>
      new Promise<boolean>((done) => {
        resolve = done
      })
  )
  render(
    <MemoryRouter>
      <ConversationPanelComposer
        conversation={conversation}
        draft="不能丢"
        draftMentions={[]}
        onCancelReply={vi.fn()}
        onDraftChange={vi.fn()}
        onRichTextModeChange={vi.fn()}
        onSendFile={async () => null}
        onSendImage={async () => null}
        onSendMessage={onSendMessage}
        onSendVoice={async () => null}
        replyTarget={null}
        richTextMode={false}
        sending
      />
    </MemoryRouter>
  )
  const editor = screen.getByPlaceholderText("输入消息")
  fireEvent.keyDown(editor, { key: "Enter" })
  fireEvent.keyDown(editor, { key: "Enter" })
  expect(onSendMessage).toHaveBeenCalledTimes(1)
  expect(editor).toHaveValue("")
  resolve(false)
  await waitFor(() => expect(editor).toHaveValue("不能丢"))
})

const conversation: ClientConversation = {
  avatar: "",
  createdAt: "2026-08-26T00:00:00Z",
  id: "conversation-1",
  lastMessageAt: null,
  lastMessageId: null,
  lastMessageSeq: 0,
  lastMessageSender: null,
  lastMessageSummary: "",
  lastChoiceSeq: 0,
  lastMentionedSeq: 0,
  lastReadSeq: 0,
  memberCount: 2,
  name: "测试会话",
  type: "direct",
  unreadCount: 0,
  visibility: "private",
}
