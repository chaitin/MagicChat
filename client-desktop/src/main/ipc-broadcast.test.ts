import { describe, expect, it, vi } from "vitest"

import { broadcastToWindows } from "@main/ipc-broadcast"
import { realtimeSnapshotDeliveryEvents } from "@main/realtime-snapshot-diagnostics"

describe("broadcastToWindows", () => {
  it("分别统计成功和失败的 IPC 投递，跳过已销毁窗口", () => {
    const sent = vi.fn()
    const result = broadcastToWindows("desktop:v1:test", { value: 1 }, [
      { isDestroyed: () => false, webContents: { send: sent } },
      {
        isDestroyed: () => false,
        webContents: {
          send: () => {
            throw new Error("webContents 已销毁")
          },
        },
      },
      { isDestroyed: () => true, webContents: { send: vi.fn() } },
    ])

    expect(sent).toHaveBeenCalledWith("desktop:v1:test", { value: 1 })
    expect(result).toEqual({ delivered: 1, failed: 1 })
  })

  it("将投递失败写成可关联的 realtime-bridge 事件", () => {
    const events = realtimeSnapshotDeliveryEvents(
      {
        connectionInstanceId: "connection-1",
        episodeId: "episode-1",
        ready: true,
        stateRevision: 1,
        status: "connected",
        targetKey: "target",
        targetScope: "server-1",
      },
      { delivered: 1, failed: 2 },
    )

    expect(events).toEqual([
      expect.objectContaining({
        data: { deliverySucceededCount: 1 },
        type: "realtime-bridge.snapshot-sent",
      }),
      expect.objectContaining({
        context: expect.objectContaining({
          connectionInstanceId: "connection-1",
          episodeId: "episode-1",
        }),
        data: { deliveryFailureCount: 2 },
        type: "realtime-bridge.delivery-failed",
      }),
    ])
  })
})
