import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useVoiceRecording } from "./use-voice-recording"

const asr = vi.hoisted(() => ({
  close: vi.fn(),
  commit: vi.fn(),
  connect: vi.fn(() => new Promise<void>(() => undefined)),
  sendAudio: vi.fn(),
}))

vi.mock("@/lib/asr-realtime-client", () => ({
  ASRRealtimeClient: class {
    close = asr.close
    commit = asr.commit
    connect = asr.connect
    sendAudio = asr.sendAudio
  },
}))

describe("useVoiceRecording ASR fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    asr.close.mockClear()
    asr.commit.mockClear()
    asr.connect.mockClear()
    asr.sendAudio.mockClear()
    installAudioMocks()
  })

  afterEach(() => vi.useRealTimers())

  it("starts WebM recording without waiting for ASR ready", async () => {
    const { result } = renderHook(() => useVoiceRecording())

    await act(async () => {
      await result.current.startRecording()
    })

    expect(MockMediaRecorder.latest?.start).toHaveBeenCalledWith(250)
    expect(result.current.status).toBe("recording")
    expect(asr.connect).toHaveBeenCalledOnce()
  })

  it("shows processing and waits 500 ms before flushing", async () => {
    const { result } = renderHook(() => useVoiceRecording())
    await act(async () => {
      await result.current.startRecording()
    })
    const worklet = MockAudioWorkletNode.latest!
    worklet.port.postMessage.mockClear()

    act(() => result.current.stopRecording())
    expect(result.current.status).toBe("processing")
    act(() => vi.advanceTimersByTime(499))
    expect(worklet.port.postMessage).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))
    expect(worklet.port.postMessage).toHaveBeenCalledWith({ type: "flush" })
    act(() =>
      worklet.port.onmessage?.(
        new MessageEvent("message", { data: { type: "flushed" } })
      )
    )
    expect(MockMediaRecorder.latest?.stop).toHaveBeenCalledOnce()
  })

  it("forces MediaRecorder to stop when the worklet does not flush", async () => {
    const { result } = renderHook(() => useVoiceRecording())
    await act(async () => {
      await result.current.startRecording()
    })

    act(() => result.current.stopRecording())
    expect(MockMediaRecorder.latest?.stop).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(999))
    expect(MockMediaRecorder.latest?.stop).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(MockMediaRecorder.latest?.stop).toHaveBeenCalledOnce()
  })
})

class MockMediaRecorder {
  static isTypeSupported = vi.fn(() => true)
  static latest: MockMediaRecorder | null = null
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onstop: ((event: Event) => void) | null = null
  state: RecordingState = "inactive"
  start = vi.fn(() => {
    this.state = "recording"
  })
  stop = vi.fn(() => {
    this.state = "inactive"
  })

  constructor() {
    MockMediaRecorder.latest = this
  }
}

class MockAudioWorkletNode {
  static latest: MockAudioWorkletNode | null = null
  onprocessorerror: ((event: Event) => void) | null = null
  disconnect = vi.fn()
  port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn(),
  }

  constructor() {
    MockAudioWorkletNode.latest = this
  }
}

function installAudioMocks() {
  MockMediaRecorder.latest = null
  MockAudioWorkletNode.latest = null
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  })
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      })),
    },
  })

  vi.stubGlobal("MediaRecorder", MockMediaRecorder)
  vi.stubGlobal("AudioWorkletNode", MockAudioWorkletNode)
  vi.stubGlobal(
    "AudioContext",
    class {
      audioWorklet = { addModule: vi.fn(async () => undefined) }
      currentTime = 0
      sampleRate = 48_000
      state: AudioContextState = "running"
      close = vi.fn(async () => undefined)
      createAnalyser = () => ({
        disconnect: vi.fn(),
        fftSize: 0,
        getByteTimeDomainData: vi.fn(),
        smoothingTimeConstant: 0,
      })
      createMediaStreamSource = () => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      })
      resume = vi.fn(async () => undefined)
    }
  )
}
