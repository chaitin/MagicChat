import { describe, expect, it, vi } from "vitest"

import { ASRRealtimeClient } from "./asr-realtime-client"

describe("ASRRealtimeClient", () => {
  it("waits for ready before resolving and sends PCM followed by one commit", async () => {
    const socket = new MockWebSocket()
    const client = new ASRRealtimeClient({
      createWebSocket: () => socket as unknown as WebSocket,
      url: "ws://example.test/asr",
    })
    let connected = false
    const connecting = client.connect().then(() => {
      connected = true
    })

    await Promise.resolve()
    expect(connected).toBe(false)
    socket.emit({ type: "ready" })
    await connecting

    const audio = new Uint8Array([1, 0, 2, 0]).buffer
    client.sendAudio(audio)
    client.commit()

    expect(socket.sent).toEqual([audio, JSON.stringify({ type: "commit" })])
    expect(client.getState()).toBe("committed")
    expect(() => client.commit()).toThrow("不能重复提交")
  })

  it("replaces transcript snapshots and completes cleanly", async () => {
    const socket = new MockWebSocket()
    const onTranscript = vi.fn()
    const onCompleted = vi.fn()
    const client = new ASRRealtimeClient({
      createWebSocket: () => socket as unknown as WebSocket,
      onCompleted,
      onTranscript,
      url: "ws://example.test/asr",
    })

    const connecting = client.connect()
    socket.emit({ type: "ready" })
    await connecting
    socket.emit({ type: "transcript", text: "正在" })
    socket.emit({ type: "transcript", text: "正在识别" })
    socket.emit({ type: "completed", text: "识别完成" })

    expect(onTranscript.mock.calls).toEqual([["正在"], ["正在识别"]])
    expect(onCompleted).toHaveBeenCalledWith("识别完成")
    expect(client.getState()).toBe("completed")
    expect(socket.closed).toBe(true)
  })

  it("reports terminal errors and releases the socket", async () => {
    const socket = new MockWebSocket()
    const onError = vi.fn()
    const client = new ASRRealtimeClient({
      createWebSocket: () => socket as unknown as WebSocket,
      onError,
      url: "ws://example.test/asr",
    })

    const connecting = client.connect()
    socket.emit({ type: "error", message: "上游失败" })

    await expect(connecting).rejects.toThrow("上游失败")
    expect(onError).toHaveBeenCalledWith("上游失败")
    expect(client.getState()).toBe("failed")
    expect(socket.closed).toBe(true)
  })
})

class MockWebSocket {
  binaryType: BinaryType = "blob"
  bufferedAmount = 0
  closed = false
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  readyState: number = WebSocket.OPEN
  sent: Array<string | ArrayBuffer> = []

  close() {
    this.closed = true
    this.readyState = WebSocket.CLOSED
    this.onclose?.(new CloseEvent("close"))
  }

  send(data: string | ArrayBuffer) {
    this.sent.push(data)
  }

  emit(event: object) {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(event) })
    )
  }
}
