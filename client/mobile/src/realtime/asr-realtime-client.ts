export type ASRRealtimeState =
  | "connecting"
  | "recognizing"
  | "committed"
  | "completed"
  | "failed"

type ASRSocket = Pick<
  WebSocket,
  | "binaryType"
  | "bufferedAmount"
  | "close"
  | "onclose"
  | "onerror"
  | "onmessage"
  | "readyState"
  | "send"
>

export type ASRRealtimeClientOptions = {
  createSocket?: (url: string) => ASRSocket
  onCompleted?: (text: string) => void
  onError?: (message: string) => void
  onTranscript?: (text: string) => void
  url: string
}

type ASRServerEvent = {
  message?: string
  text?: string
  type?: "ready" | "transcript" | "completed" | "error"
}

const BACKPRESSURE_THRESHOLD_BYTES = 256 * 1024
const MAX_QUEUED_AUDIO_BYTES = 2 * 1024 * 1024
const OPEN_SOCKET_STATE = 1

export class ASRRealtimeClient {
  private readonly createSocket: (url: string) => ASRSocket
  private readonly onCompleted?: (text: string) => void
  private readonly onError?: (message: string) => void
  private readonly onTranscript?: (text: string) => void
  private readonly url: string
  private audioQueue: ArrayBuffer[] = []
  private commitRequested = false
  private connectReject: ((error: Error) => void) | null = null
  private connectResolve: (() => void) | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private queuedAudioBytes = 0
  private socket: ASRSocket | null = null
  private state: ASRRealtimeState = "failed"

  constructor(options: ASRRealtimeClientOptions) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url))
    this.onCompleted = options.onCompleted
    this.onError = options.onError
    this.onTranscript = options.onTranscript
    this.url = options.url
  }

  connect() {
    if (this.socket) {
      return Promise.reject(new Error("语音识别连接已经建立"))
    }
    this.state = "connecting"
    let socket: ASRSocket
    try {
      socket = this.createSocket(this.url)
    } catch (caughtError: unknown) {
      this.state = "failed"
      return Promise.reject(
        caughtError instanceof Error
          ? caughtError
          : new Error("无法连接语音识别服务")
      )
    }
    socket.binaryType = "arraybuffer"
    this.socket = socket

    return new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve
      this.connectReject = reject
      socket.onmessage = (event) => this.handleMessage(event.data)
      socket.onerror = () => undefined
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null
        if (this.state !== "completed" && this.state !== "failed") {
          this.fail("语音识别连接已断开")
        }
      }
    })
  }

  sendAudio(audio: ArrayBuffer) {
    if (this.state !== "recognizing" || !this.socket) {
      throw new Error("语音识别尚未准备好")
    }
    if (audio.byteLength === 0 || audio.byteLength % 2 !== 0) {
      throw new Error("语音数据格式错误")
    }
    if (
      this.audioQueue.length > 0 ||
      this.socket.bufferedAmount > BACKPRESSURE_THRESHOLD_BYTES
    ) {
      this.enqueueAudio(audio)
      this.scheduleFlush()
      return
    }
    this.socket.send(audio)
  }

  commit() {
    if (this.state !== "recognizing" || !this.socket || this.commitRequested) {
      throw new Error("语音识别不能重复提交")
    }
    this.state = "committed"
    this.commitRequested = true
    this.flushQueue()
  }

  close() {
    this.clearFlushTimer()
    const socket = this.socket
    this.socket = null
    this.audioQueue = []
    this.queuedAudioBytes = 0
    if (this.state === "connecting") {
      this.connectReject?.(new Error("语音识别连接已关闭"))
      this.clearConnectPromise()
    }
    if (this.state !== "completed") this.state = "failed"
    socket?.close()
  }

  getState() {
    return this.state
  }

  private handleMessage(data: unknown) {
    if (typeof data !== "string") {
      this.fail("语音识别服务返回了无效数据")
      return
    }
    let event: ASRServerEvent
    try {
      event = JSON.parse(data) as ASRServerEvent
    } catch {
      this.fail("语音识别服务返回了无效数据")
      return
    }

    switch (event.type) {
      case "ready":
        if (this.state !== "connecting") return
        this.state = "recognizing"
        this.connectResolve?.()
        this.clearConnectPromise()
        break
      case "transcript":
        this.onTranscript?.(event.text ?? "")
        break
      case "completed":
        this.state = "completed"
        this.onCompleted?.(event.text ?? "")
        this.close()
        break
      case "error":
        this.fail(event.message || "语音识别失败")
        break
      default:
        this.fail("语音识别服务返回了无效数据")
    }
  }

  private enqueueAudio(audio: ArrayBuffer) {
    if (this.queuedAudioBytes + audio.byteLength > MAX_QUEUED_AUDIO_BYTES) {
      this.fail("语音识别发送速度过慢")
      throw new Error("语音识别发送速度过慢")
    }
    this.audioQueue.push(audio)
    this.queuedAudioBytes += audio.byteLength
  }

  private flushQueue() {
    const socket = this.socket
    if (!socket || socket.readyState !== OPEN_SOCKET_STATE) return

    while (
      this.audioQueue.length > 0 &&
      socket.bufferedAmount <= BACKPRESSURE_THRESHOLD_BYTES
    ) {
      const audio = this.audioQueue.shift()!
      this.queuedAudioBytes -= audio.byteLength
      socket.send(audio)
    }
    if (this.audioQueue.length > 0) {
      this.scheduleFlush()
      return
    }
    if (this.commitRequested) {
      this.commitRequested = false
      socket.send(JSON.stringify({ type: "commit" }))
    }
  }

  private scheduleFlush() {
    if (this.flushTimer !== null) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushQueue()
    }, 20)
  }

  private clearFlushTimer() {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  private fail(message: string) {
    if (this.state === "failed") return
    this.state = "failed"
    this.connectReject?.(new Error(message))
    this.clearConnectPromise()
    this.onError?.(message)
    this.close()
  }

  private clearConnectPromise() {
    this.connectResolve = null
    this.connectReject = null
  }
}

export function buildASRWebSocketUrl(serverUrl: string) {
  const url = new URL("api/client/asr/realtime", ensureTrailingSlash(serverUrl))
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

function ensureTrailingSlash(value: string) {
  return `${value.replace(/\/+$/, "")}/`
}
