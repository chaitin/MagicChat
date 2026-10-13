import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MessageVoice } from "./message-voice"

const mocks = vi.hoisted(() => ({ readURLs: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/client-data-api", async (importOriginal) => ({ ...(await importOriginal()), readTemporaryFileURLs: mocks.readURLs }))
vi.mock("sonner", () => ({ toast: { error: mocks.error } }))
const voice = { contentType: "audio/webm", durationMS: 42_800, fileId: "voice-file-1", sizeBytes: 1024, transcript: "语音摘要", type: "voice" as const }

beforeEach(() => {
  mocks.readURLs.mockReset().mockImplementation(async (ids: string[]) => ids.map((fileId) => ({ fileId, url: `https://assets.example.test/${fileId}` })))
  mocks.error.mockReset()
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { configurable: true, value: false })
    this.dispatchEvent(new Event("playing"))
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { configurable: true, value: true })
    this.dispatchEvent(new Event("pause"))
  })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe("MessageVoice", () => {
  it("renders Desktop's icon/title-time/transcript/action layout", () => {
    const { container } = render(<MessageVoice voice={voice} />)
    expect(container.firstElementChild).toHaveClass("flex", "w-80", "items-center", "gap-3")
    expect(screen.getByText("语音 - 0:42")).toBeInTheDocument()
    expect(screen.getByText(voice.transcript)).toHaveClass("truncate", "text-xs")
    expect(container.querySelector("svg")).toHaveClass("size-7", "text-foreground")
    const button = screen.getByRole("button", { name: "播放语音" })
    expect(button).toHaveClass("hover:bg-foreground/5", "active:bg-foreground/5")
    expect(button.querySelector("svg")).toHaveClass("group-hover/message-bubble:text-xgui-brand-5")
    expect(button.querySelector("svg circle")).toHaveAttribute("stroke-width", "1.5")
    expect(button.querySelector('svg path[fill="currentColor"]')).not.toBeNull()
    expect(screen.queryByRole("button", { name: "展开语音文字" })).not.toBeInTheDocument()
  })

  it("plays, updates elapsed time, pauses and restores total duration on end", async () => {
    const user = userEvent.setup()
    const { container } = render(<MessageVoice voice={voice} />)
    const audio = container.querySelector("audio")!
    await user.click(screen.getByRole("button", { name: "播放语音" }))
    expect(audio).toHaveAttribute("src", "https://assets.example.test/voice-file-1")
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce()
    audio.currentTime = 12.9
    fireEvent.timeUpdate(audio)
    expect(screen.getByText("语音 - 0:12")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "暂停语音" }))
    expect(screen.getByRole("button", { name: "播放语音" })).toBeEnabled()
    expect(screen.getByText("语音 - 0:12")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "播放语音" }))
    fireEvent.ended(audio)
    expect(screen.getByText("语音 - 0:42")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "播放语音" })).toBeEnabled()
    expect(mocks.readURLs).toHaveBeenCalledExactlyOnceWith([voice.fileId])
  })

  it("spins and disables while preparing, then shows pause; empty transcripts have a placeholder", async () => {
    let resolve!: (value: { fileId: string; url: string }[]) => void
    mocks.readURLs.mockReturnValue(new Promise((done) => { resolve = done }))
    render(<MessageVoice voice={{ ...voice, transcript: "" }} />)
    fireEvent.click(screen.getByRole("button", { name: "播放语音" }))
    const button = screen.getByRole("button", { name: "正在加载语音" })
    expect(button).toBeDisabled()
    expect(button.querySelector("svg")).toHaveClass("animate-spin")
    expect(screen.getByText("暂无文字摘要")).toBeInTheDocument()
    await act(async () => resolve([{ fileId: voice.fileId, url: "https://assets.example.test/voice" }]))
    await waitFor(() => expect(screen.getByRole("button", { name: "暂停语音" })).toBeEnabled())
  })

  it("shows the loading animation during buffering and resumes when playing", async () => {
    const { container } = render(<MessageVoice voice={voice} />)
    fireEvent.click(screen.getByRole("button", { name: "播放语音" }))
    await screen.findByRole("button", { name: "暂停语音" })
    const audio = container.querySelector("audio")!
    fireEvent.waiting(audio)
    expect(screen.getByRole("button", { name: "正在加载语音" })).toBeDisabled()
    fireEvent.playing(audio)
    expect(screen.getByRole("button", { name: "暂停语音" })).toBeEnabled()
  })

  it("pauses the previous voice when another starts", async () => {
    const { container } = render(<><MessageVoice voice={voice} /><MessageVoice voice={{ ...voice, fileId: "voice-file-2" }} /></>)
    const audio = container.querySelectorAll("audio")
    fireEvent.click(screen.getAllByRole("button", { name: "播放语音" })[0])
    await screen.findByRole("button", { name: "暂停语音" })
    fireEvent.click(screen.getByRole("button", { name: "播放语音" }))
    await waitFor(() => expect(audio[0].paused).toBe(true))
    expect(audio[1].paused).toBe(false)
    expect(screen.getAllByRole("button", { name: "暂停语音" })).toHaveLength(1)
  })

  it("reports failure and permits retry", async () => {
    mocks.readURLs.mockRejectedValueOnce(new Error("offline"))
    render(<MessageVoice voice={voice} />)
    fireEvent.click(screen.getByRole("button", { name: "播放语音" }))
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("语音播放失败"))
    expect(screen.getByText("语音 - 0:42")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "播放语音" }))
    await screen.findByRole("button", { name: "暂停语音" })
  })

  it("does not start audio if unmounted while its URL request is pending", async () => {
    let resolve!: (value: { fileId: string; url: string }[]) => void
    mocks.readURLs.mockReturnValue(new Promise((done) => { resolve = done }))
    const { unmount } = render(<MessageVoice voice={voice} />)
    fireEvent.click(screen.getByRole("button", { name: "播放语音" }))
    unmount()
    await act(async () => resolve([{ fileId: voice.fileId, url: "https://assets.example.test/voice" }]))
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it("times out a stalled play request and restores idle state", async () => {
    vi.useFakeTimers()
    vi.mocked(HTMLMediaElement.prototype.play).mockReturnValue(new Promise(() => {}))
    render(<MessageVoice voice={voice} />)
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "播放语音" })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(15_001) })
    expect(mocks.error).toHaveBeenCalledWith("语音播放失败")
    expect(screen.getByRole("button", { name: "播放语音" })).toBeEnabled()
    expect(screen.getByText("语音 - 0:42")).toBeInTheDocument()
  })
})
