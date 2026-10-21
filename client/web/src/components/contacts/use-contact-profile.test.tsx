import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useContactProfile } from "./use-contact-profile"
import type { ActiveDirectoryItem } from "./contact-directory"

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/client-api/entity-sync", () => ({
  resolveClientEntities: mocks.resolve,
}))
vi.mock("sonner", () => ({ toast: { error: mocks.error } }))

const id = "550e8400-e29b-41d4-a716-446655440000"
const selection = { type: "group" as const, id }
const cachedGroup = (revision: number): ActiveDirectoryItem => ({
  type: "group",
  group: {
    id,
    name: `revision-${revision}`,
    entityRevision: revision,
    avatar: "",
    avatarMembers: [],
    type: "group",
    joined: true,
    memberCount: 2,
    visibility: "public",
  },
})
const snapshot = (revision: number, removed: boolean) => ({
  users: [],
  apps: [],
  conversations: [],
  groups: removed
    ? []
    : [
        (
          cachedGroup(revision) as Extract<
            ActiveDirectoryItem,
            { type: "group" }
          >
        ).group,
      ],
  versions: { [`group:${id}`]: revision },
  removed: removed ? [selection] : [],
})
const deferred = () => {
  let resolve!: (value: ReturnType<typeof snapshot>) => void
  const promise = new Promise<ReturnType<typeof snapshot>>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("名片资料只读查询", () => {
  it("旧移除响应晚于新加入资料返回时，不删除或隐藏最新资料", async () => {
    const pending = deferred()
    mocks.resolve.mockReset().mockReturnValue(pending.promise)
    mocks.error.mockClear()
    const { result, rerender } = renderHook(
      ({ cached }) => useContactProfile({ selection, cached, accountId: "me" }),
      {
        initialProps: { cached: cachedGroup(1) as ActiveDirectoryItem | null },
      }
    )
    const latest = cachedGroup(2)
    rerender({ cached: latest })
    await act(async () => {
      pending.resolve(snapshot(1, true))
    })
    expect(result.current).toBe(latest)
    expect(mocks.error).not.toHaveBeenCalled()
    expect(mocks.resolve).toHaveBeenCalledOnce()
  })

  it("旧可见响应不能恢复已被实时同步移除的资料", async () => {
    const pending = deferred()
    mocks.resolve.mockReset().mockReturnValue(pending.promise)
    const { result, rerender } = renderHook(
      ({ cached }: { cached: ActiveDirectoryItem | null }) =>
        useContactProfile({ selection, cached, accountId: "me" }),
      {
        initialProps: { cached: cachedGroup(1) as ActiveDirectoryItem | null },
      }
    )
    rerender({ cached: null })
    await act(async () => {
      pending.resolve(snapshot(1, false))
    })
    expect(result.current).toBeNull()
  })

  it("支持目录外资料，查询结果不依赖写入通讯录", async () => {
    mocks.resolve.mockReset().mockResolvedValue(snapshot(2, false))
    const { result } = renderHook(() =>
      useContactProfile({ selection, cached: null, accountId: "me" })
    )
    await waitFor(() => expect(result.current?.type).toBe("group"))
    expect(
      (result.current as Extract<ActiveDirectoryItem, { type: "group" }>).group
        .entityRevision
    ).toBe(2)
  })

  it("新移除响应可以隐藏旧缓存，网络错误则保留缓存", async () => {
    mocks.resolve.mockReset().mockResolvedValueOnce(snapshot(2, true))
    const { result, unmount } = renderHook(() =>
      useContactProfile({ selection, cached: cachedGroup(1), accountId: "me" })
    )
    await waitFor(() => expect(result.current).toBeNull())
    unmount()
    mocks.resolve.mockRejectedValueOnce(new Error("offline"))
    const cached = cachedGroup(1)
    const retry = renderHook(() =>
      useContactProfile({ selection, cached, accountId: "me" })
    )
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("无法加载资料，请重试")
    )
    expect(retry.result.current).toBe(cached)
  })

  it("切账号后旧请求不能把资料带入新账号", async () => {
    const pending = deferred()
    mocks.resolve
      .mockReset()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(snapshot(2, true))
    const { result, rerender } = renderHook(
      ({ accountId }) =>
        useContactProfile({ selection, cached: null, accountId }),
      {
        initialProps: { accountId: "first" },
      }
    )
    rerender({ accountId: "second" })
    await act(async () => {
      pending.resolve(snapshot(1, false))
    })
    expect(result.current).toBeNull()
  })
})
