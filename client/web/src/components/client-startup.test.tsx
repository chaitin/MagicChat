import { act, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ClientConversationRealtimeSync } from "@/components/client-conversation-realtime-sync"
import { ClientRealtimeProvider } from "@/components/client-realtime-provider"
import { RealtimeClient, type RealtimeWebSocketLike } from "@/lib/realtime-client"

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), sync: vi.fn(), setAuthenticated: vi.fn() }))
vi.mock("@/lib/client-data-context", () => ({ useClientData: () => ({
  refreshConversations: mocks.refresh, syncLoadedConversationMessages: mocks.sync,
}) }))
vi.mock("@/lib/app-info-context", () => ({ useAppInfo: () => ({ setAuthenticated: mocks.setAuthenticated }) }))

describe("Web实时连接不阻挡首屏", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.refresh.mockResolvedValue([{ id: "fresh" }]); mocks.sync.mockResolvedValue(undefined) })

  it.each([false, true])("首屏不等待握手，首次已就绪=%s时也补取订阅后的会话快照", async (alreadyReady) => {
    const socket: RealtimeWebSocketLike = {
      onopen: null, onclose: null, onerror: null, onmessage: null, readyState: 1,
      close: vi.fn(), send: vi.fn(),
    }
    const client = new RealtimeClient({ url: "ws://localhost/api/client/ws", createWebSocket: () => socket })
    const handshake = () => socket.onmessage?.({ data: JSON.stringify({ v: 1, kind: "event", event: "system.ready" }) } as MessageEvent)
    if (alreadyReady) { client.connect(); handshake() }
    const view = render(<MemoryRouter><ClientRealtimeProvider client={client}>
      <span>主界面</span><ClientConversationRealtimeSync />
    </ClientRealtimeProvider></MemoryRouter>)
    expect(screen.getByText("主界面")).toBeInTheDocument()
    if (!alreadyReady) {
      expect(mocks.refresh).not.toHaveBeenCalled()
      act(handshake)
    }
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledExactlyOnceWith([{ id: "fresh" }]))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})
