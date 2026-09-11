import assert from "node:assert/strict"
import test from "node:test"

import {
  ASRRealtimeClient,
  buildASRWebSocketUrl,
} from "../src/realtime/asr-realtime-client.ts"

test("waits for ready then sends PCM followed by one commit", async () => {
  const socket = new MockSocket()
  const client = new ASRRealtimeClient({
    createSocket: () => socket as unknown as WebSocket,
    url: "ws://example.test/asr",
  })
  let connected = false
  const connecting = client.connect().then(() => {
    connected = true
  })

  await Promise.resolve()
  assert.equal(connected, false)
  socket.emit({ type: "ready" })
  await connecting

  const audio = new Uint8Array([1, 0, 2, 0]).buffer
  client.sendAudio(audio)
  client.commit()

  assert.deepEqual(socket.sent, [audio, JSON.stringify({ type: "commit" })])
  assert.equal(client.getState(), "committed")
  assert.throws(() => client.commit(), /不能重复提交/)
})

test("publishes transcript snapshots and completes cleanly", async () => {
  const socket = new MockSocket()
  const transcripts: string[] = []
  const completed: string[] = []
  const client = new ASRRealtimeClient({
    createSocket: () => socket as unknown as WebSocket,
    onCompleted: (text) => completed.push(text),
    onTranscript: (text) => transcripts.push(text),
    url: "ws://example.test/asr",
  })

  const connecting = client.connect()
  socket.emit({ type: "ready" })
  await connecting
  socket.emit({ text: "正在", type: "transcript" })
  socket.emit({ text: "正在识别", type: "transcript" })
  socket.emit({ text: "识别完成", type: "completed" })

  assert.deepEqual(transcripts, ["正在", "正在识别"])
  assert.deepEqual(completed, ["识别完成"])
  assert.equal(client.getState(), "completed")
  assert.equal(socket.closed, true)
})

test("reports server errors and releases the socket", async () => {
  const socket = new MockSocket()
  const errors: string[] = []
  const client = new ASRRealtimeClient({
    createSocket: () => socket as unknown as WebSocket,
    onError: (message) => errors.push(message),
    url: "ws://example.test/asr",
  })

  const connecting = client.connect()
  socket.emit({ message: "上游失败", type: "error" })

  await assert.rejects(connecting, /上游失败/)
  assert.deepEqual(errors, ["上游失败"])
  assert.equal(client.getState(), "failed")
  assert.equal(socket.closed, true)
})

test("builds the ASR URL from the immutable server URL", () => {
  assert.equal(
    buildASRWebSocketUrl("https://chat.example.test/base"),
    "wss://chat.example.test/base/api/client/asr/realtime"
  )
  assert.equal(
    buildASRWebSocketUrl("http://10.0.2.2:8080"),
    "ws://10.0.2.2:8080/api/client/asr/realtime"
  )
})

class MockSocket {
  binaryType: BinaryType = "blob"
  bufferedAmount = 0
  closed = false
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  readyState = 1
  sent: (string | ArrayBuffer)[] = []

  close() {
    this.closed = true
    this.readyState = 3
    this.onclose?.({} as CloseEvent)
  }

  send(data: string | ArrayBuffer) {
    this.sent.push(data)
  }

  emit(event: object) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent)
  }
}
