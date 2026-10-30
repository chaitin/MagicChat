import type { BrowserWindow, WebContents } from "electron"

type RendererContents = Pick<WebContents, "isDestroyed" | "mainFrame">
type MainWindow = Pick<BrowserWindow, "isDestroyed" | "webContents">
type PendingMessage = { args: unknown[]; isValid: () => boolean }

function isDisposedFrameError(error: unknown) {
  return (
    error instanceof Error &&
    /(?:(?:render frame|webframemain).*(?:disposed|destroyed|detached)|object has been destroyed)/i.test(
      error.message,
    )
  )
}

export function sendToRenderer(
  contents: RendererContents | null | undefined,
  channel: string,
  ...args: unknown[]
) {
  try {
    if (!contents || contents.isDestroyed()) return false
    const frame = contents.mainFrame
    if (frame.isDestroyed() || frame.detached) return false
    frame.send(channel, ...args)
    return true
  } catch (error) {
    if (isDisposedFrameError(error)) return false
    throw error
  }
}

export class MainWindowMessages {
  private readonly getWindow: () => MainWindow | null
  private readonly subscriptions = new Set<string>()
  private readonly pending = new Map<string, PendingMessage>()

  constructor(getWindow: () => MainWindow | null) {
    this.getWindow = getWindow
  }

  pause() {
    this.subscriptions.clear()
  }

  setReady(channel: string, ready: boolean) {
    if (ready) this.subscriptions.add(channel)
    else this.subscriptions.delete(channel)
    this.flush()
  }

  send(channel: string, ...args: unknown[]) {
    const window = this.getWindow()
    if (!this.subscriptions.has(channel) || !window || window.isDestroyed()) return false
    // A subscribed frame may already read its initial snapshot before loading stops.
    // Deliver subsequent changes immediately so that snapshot cannot become stale.
    return sendToRenderer(window.webContents, channel, ...args)
  }

  // Keep only the latest user action per channel; background state is re-read after reload.
  sendWhenReady(channel: string, args: unknown[] = [], isValid: () => boolean = () => true) {
    this.pending.set(channel, { args, isValid })
    this.flush()
  }

  flush() {
    const window = this.getWindow()
    const loaded = Boolean(
      window &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      !window.webContents.isLoadingMainFrame(),
    )
    for (const [channel, message] of this.pending) {
      if (!message.isValid() || (loaded && this.send(channel, ...message.args)))
        this.pending.delete(channel)
    }
  }
}
