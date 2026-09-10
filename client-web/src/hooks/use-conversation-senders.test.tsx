import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ClientMessage } from "@/lib/client-data-api"
import { createConversationMessageState } from "@/lib/client-data-state"
import { useConversationSenders } from "@/hooks/use-conversation-senders"

const mocks = vi.hoisted(() => ({
  sendConversationTextMessage: vi.fn(),
  sendConversationVideoMessage: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("@/lib/client-data-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-data-api")>()
  return {
    ...actual,
    sendConversationTextMessage: mocks.sendConversationTextMessage,
    sendConversationVideoMessage: mocks.sendConversationVideoMessage,
  }
})

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}))

describe("useConversationSenders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("immediately enqueues a sending message before the request completes", async () => {
    const request = createDeferred<ClientMessage>()
    mocks.sendConversationTextMessage.mockReturnValue(request.promise)
    const mergeIncomingConversationMessage = vi.fn()
    const { result } = renderHook(() =>
      useConversationSenders({
        conversationMessageStatesRef: {
          current: {
            "conversation-1": {
              ...createConversationMessageState(),
              latestKnownSeq: 4,
            },
          },
        },
        currentUserId: "user-1",
        getConversationAccountGeneration: () => 0,
        mergeIncomingConversationMessage,
        updateConversationMessageState: vi.fn(),
      })
    )

    let accepted!: ClientMessage | null
    await act(async () => {
      accepted = await result.current.sendConversationText(
        "conversation-1",
        "立即显示"
      )
    })

    expect(accepted).toMatchObject({
      body: { content: "立即显示", type: "text" },
      deliveryStatus: "sending",
      sender: { id: "user-1", type: "user" },
      seq: 5,
    })
    expect(mergeIncomingConversationMessage).toHaveBeenCalledTimes(1)
    expect(mergeIncomingConversationMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        deliveryStatus: "sending",
        id: expect.stringMatching(/^optimistic:/),
      }),
      { markLoaded: true }
    )

    const confirmed = {
      ...accepted!,
      deliveryStatus: undefined,
      id: "message-5",
    }
    request.resolve(confirmed)

    await waitFor(() =>
      expect(mergeIncomingConversationMessage).toHaveBeenLastCalledWith(
        confirmed,
        { markLoaded: true }
      )
    )
  })

  it("immediately enqueues a local video and replaces it after upload", async () => {
    const request = createDeferred<ClientMessage>()
    mocks.sendConversationVideoMessage.mockReturnValue(request.promise)
    const createObjectURL = vi.fn(() => "blob:optimistic-video")
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })
    const mergeIncomingConversationMessage = vi.fn()
    const { result } = renderHook(() =>
      useConversationSenders({
        conversationMessageStatesRef: { current: {} },
        currentUserId: "user-1",
        getConversationAccountGeneration: () => 0,
        mergeIncomingConversationMessage,
        updateConversationMessageState: vi.fn(),
      })
    )
    const video = new File(["video"], "demo.mp4", { type: "video/mp4" })

    let accepted!: ClientMessage | null
    await act(async () => {
      accepted = await result.current.sendConversationVideo(
        "conversation-1",
        video,
        { caption: "演示视频", captionType: "text" }
      )
    })

    expect(accepted?.body).toEqual({
      caption: "演示视频",
      captionType: "text",
      contentType: "video/mp4",
      fileId: accepted?.clientMessageId,
      localURL: "blob:optimistic-video",
      name: "demo.mp4",
      sizeBytes: 5,
      type: "video",
    })
    expect(accepted?.deliveryStatus).toBe("sending")
    expect(mocks.sendConversationVideoMessage).toHaveBeenCalledWith(
      "conversation-1",
      expect.objectContaining({ caption: "演示视频", video })
    )

    request.resolve({
      ...accepted!,
      body: {
        caption: "演示视频",
        captionType: "text",
        contentType: "video/mp4",
        fileId: "video-1",
        name: "demo.mp4",
        sizeBytes: 5,
        type: "video",
      },
      deliveryStatus: undefined,
      id: "message-video-1",
    })
    await waitFor(() =>
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:optimistic-video")
    )
  })

  it("keeps a failed optimistic message retryable without replacing the list preview", async () => {
    mocks.sendConversationTextMessage.mockRejectedValue(new Error("offline"))
    const mergeIncomingConversationMessage = vi.fn()
    const { result } = renderHook(() =>
      useConversationSenders({
        conversationMessageStatesRef: { current: {} },
        currentUserId: "user-1",
        getConversationAccountGeneration: () => 0,
        mergeIncomingConversationMessage,
        updateConversationMessageState: vi.fn(),
      })
    )

    await act(async () => {
      await result.current.sendConversationText("conversation-1", "稍后重试")
    })

    await waitFor(() =>
      expect(mergeIncomingConversationMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ deliveryStatus: "failed" }),
        { markLoaded: true, updateList: false }
      )
    )
    expect(mocks.toastError).toHaveBeenCalledWith("发送消息失败")
  })
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
