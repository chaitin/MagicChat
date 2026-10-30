import { act, render, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ClientEntityRealtimeSync } from "@/components/client-entity-realtime-sync"

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => void>(),
  resolve: vi.fn(), apply: vi.fn(), refresh: vi.fn(),
  data: { me: { id: "me" }, contactApps: [] as { id: string }[], contactGroups: [] as { id: string; joined: boolean }[], conversations: [] as { id: string; type: string; topic?: { parentConversationId: string; parentConversationType: string } }[], usersById: {} as Record<string, unknown> },
  realtime: { ready: false },
  foregroundConversationId: "",
  profiles: new Map<string, { id: string; syncedAt: number; snapshot: unknown }>(),
  subscribe: vi.fn((event: string, handler: (payload: unknown) => void) => {
    mocks.handlers.set(event, handler)
    return () => { mocks.handlers.delete(event) }
  }),
}))
vi.mock("@/lib/client-data-context", () => ({ useClientData: () => ({ ...mocks.data, foregroundConversationId: mocks.foregroundConversationId, applyEntitySnapshot: mocks.apply, refreshContacts: mocks.refresh }) }))
vi.mock("@/lib/realtime-context", () => ({ useRealtime: () => ({ ...mocks.realtime, subscribeRealtimeEvent: mocks.subscribe }) }))
vi.mock("@/lib/client-api/entity-sync", () => ({ resolveClientEntities: (entities: unknown) => mocks.resolve(entities) }))
vi.mock("@/lib/group-profile-cache", async (original) => {
  const actual = await original<typeof import("@/lib/group-profile-cache")>()
  return { ...actual, createWebGroupProfileStore: (accountId: string) => ({
    read: async (ids: string[]) => ids.flatMap((id) => {
      const record = mocks.profiles.get(`${accountId}:${id}`)
      return record ? [record] : []
    }),
    write: async (records: { id: string; syncedAt: number; snapshot: unknown }[]) => {
      for (const record of records) mocks.profiles.set(`${accountId}:${record.id}`, record)
    },
    remove: async (ids: string[]) => { for (const id of ids) mocks.profiles.delete(`${accountId}:${id}`) },
    close: async () => undefined,
  }) }
})

const groupSnapshot = (revision = 1) => ({
  users: [], apps: [], removed: [], versions: { "group:g1": revision },
  groups: [{ id: "g1", joined: true }],
  conversations: [{ id: "g1", type: "group", members: [], entityRevision: revision }],
})

describe("实体实时同步", () => {
  beforeEach(() => {
    mocks.handlers.clear(); mocks.resolve.mockReset(); mocks.apply.mockReset(); mocks.refresh.mockReset().mockResolvedValue(undefined)
    mocks.data = { me: { id: "me" }, contactApps: [], contactGroups: [], conversations: [], usersById: {} }
    mocks.realtime.ready = false
    mocks.foregroundConversationId = ""
    mocks.profiles.clear()
  })
  afterEach(() => vi.restoreAllMocks())

  it("刷新后恢复完整缓存，一小时内初始化不请求；进群和再次进入仍强刷", async () => {
    const snapshot = groupSnapshot()
    mocks.profiles.set("me:g1", { id: "g1", syncedAt: Date.now(), snapshot })
    mocks.data.contactGroups = [{ id: "g1", joined: true }]
    mocks.data.conversations = [{ id: "g1", type: "group" }]
    mocks.realtime.ready = true
    mocks.resolve.mockResolvedValue(snapshot)
    const view = render(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.apply).toHaveBeenCalled())
    await act(async () => undefined)
    expect(mocks.resolve).not.toHaveBeenCalled()
    mocks.foregroundConversationId = "g1"
    view.rerender(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))
    await act(async () => undefined)
    mocks.foregroundConversationId = ""
    view.rerender(<ClientEntityRealtimeSync />)
    mocks.foregroundConversationId = "g1"
    view.rerender(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(2))
    await act(async () => undefined)
    view.unmount()
    mocks.foregroundConversationId = ""
    render(<ClientEntityRealtimeSync />)
    await act(async () => undefined)
    expect(mocks.resolve).toHaveBeenCalledTimes(2)
  })

  it("从群聊切到同群话题仍强刷父群，话题ID不作为群ID请求", async () => {
    mocks.profiles.set("me:g1", { id: "g1", syncedAt: Date.now(), snapshot: groupSnapshot() })
    mocks.data.contactGroups = [{ id: "g1", joined: true }]
    mocks.data.conversations = [{ id: "g1", type: "group" },
      { id: "t1", type: "topic", topic: { parentConversationId: "g1", parentConversationType: "group" } }]
    mocks.foregroundConversationId = "g1"
    mocks.realtime.ready = true
    mocks.resolve.mockResolvedValue(groupSnapshot())
    const view = render(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))
    await act(async () => undefined)
    mocks.foregroundConversationId = "t1"
    view.rerender(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(2))
    expect(mocks.resolve.mock.calls.every((call) => call[0][0].id === "g1")).toBe(true)
  })

  it("回到可见页面强刷当前群，后台批量校准仍遵循TTL", async () => {
    mocks.profiles.set("me:g1", { id: "g1", syncedAt: Date.now(), snapshot: groupSnapshot() })
    mocks.data.contactGroups = [{ id: "g1", joined: true }]
    mocks.data.conversations = [{ id: "g1", type: "group" }]
    mocks.foregroundConversationId = "g1"
    mocks.realtime.ready = true
    mocks.resolve.mockResolvedValue(groupSnapshot())
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    render(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))
    await act(async () => undefined)
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(2))
  })

  it("被本地新版本拒绝的响应不续期；不可访问的完整结果清除缓存", async () => {
    const syncedAt = Date.now() - 10_000
    mocks.profiles.set("me:g1", { id: "g1", syncedAt, snapshot: groupSnapshot(3) })
    mocks.data.contactGroups = [{ id: "g1", joined: true }]
    mocks.data.conversations = [{ id: "g1", type: "group" }]
    mocks.realtime.ready = true
    mocks.resolve.mockResolvedValue(groupSnapshot(2))
    mocks.apply.mockReturnValue({ syncedGroups: [] })
    const view = render(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.apply).toHaveBeenCalled())
    await act(async () => undefined)
    mocks.foregroundConversationId = "g1"
    view.rerender(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))
    await act(async () => undefined)
    expect(mocks.profiles.get("me:g1")?.syncedAt).toBe(syncedAt)
    mocks.foregroundConversationId = ""
    view.rerender(<ClientEntityRealtimeSync />)
    mocks.resolve.mockResolvedValue({ users: [], apps: [], groups: [], conversations: [], versions: {}, removed: [{ type: "group", id: "g1" }] })
    mocks.foregroundConversationId = "g1"
    view.rerender(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.profiles.has("me:g1")).toBe(false))
  })

  it("过期缓存重新校准，实时变更不受TTL限制；失败不续期", async () => {
    const snapshot = groupSnapshot()
    mocks.profiles.set("me:g1", { id: "g1", syncedAt: Date.now() - 60 * 60_000, snapshot })
    mocks.data.contactGroups = [{ id: "g1", joined: true }]
    mocks.realtime.ready = true
    mocks.resolve.mockResolvedValue(snapshot)
    render(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))
    await act(async () => undefined)
    expect(mocks.profiles.get("me:g1")?.syncedAt).toBeGreaterThan(Date.now() - 60_000)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    mocks.resolve.mockRejectedValue(new Error("offline"))
    act(() => mocks.handlers.get("conversation.members.updated")?.({ conversation_id: "g1", revision: 2 }))
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(mocks.profiles.has("me:g1")).toBe(false)
  })

  it("只有时间而无完整资料不能跳过，其他账号缓存不能恢复", async () => {
    mocks.profiles.set("me:g1", { id: "g1", syncedAt: Date.now(), snapshot: { ...groupSnapshot(), conversations: [] } })
    mocks.profiles.set("other:g1", { id: "g1", syncedAt: Date.now(), snapshot: groupSnapshot(9) })
    mocks.data.contactGroups = [{ id: "g1", joined: true }]
    mocks.realtime.ready = true
    mocks.resolve.mockResolvedValue(groupSnapshot())
    render(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))
    expect(mocks.apply.mock.calls.every((call) => call[0].versions["group:g1"] !== 9)).toBe(true)
  })

  it("实体有效性检查可在延迟到渲染阶段的状态更新器中执行，切账号后仍失效", async () => {
    let check: ((entity: { type: "user"; id: string }) => boolean) | undefined
    function StateUpdateProbe() {
      const [revision, setRevision] = useState(0)
      const [name, setName] = useState("Initial")
      mocks.apply.mockImplementation((_snapshot, _entities, isCurrent) => {
        check = isCurrent
        // Another queued update makes React defer this updater until rendering.
        setRevision((value) => value + 1)
        setName((value) => isCurrent({ type: "user", id: "me" }) ? "Updated" : value)
      })
      return <><span data-testid="name">{name}:{revision}</span><ClientEntityRealtimeSync /></>
    }
    mocks.resolve.mockResolvedValue({ versions: { "user:me": 1 }, removed: [] })
    const view = render(<StateUpdateProbe />)
    act(() => mocks.handlers.get("user.profile.updated")?.({ user_id: "me", revision: 1 }))
    await waitFor(() => expect(view.getByTestId("name").textContent).toBe("Updated:1"))
    expect(check?.({ type: "user", id: "me" })).toBe(true)
    mocks.data.me = { id: "other" }
    view.rerender(<StateUpdateProbe />)
    expect(check?.({ type: "user", id: "me" })).toBe(false)
    view.unmount()
    expect(check?.({ type: "user", id: "me" })).toBe(false)
  })

  it("合并群资料和成员事件，并追到请求期间到达的最新权限版本", async () => {
    let finish!: (value: unknown) => void
    mocks.resolve.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      .mockResolvedValue({ versions: { "group:g1": 2 }, removed: [] })
    render(<ClientEntityRealtimeSync />)
    act(() => mocks.handlers.get("conversation.updated")?.({ conversation_id: "g1", revision: 1 }))
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))
    act(() => mocks.handlers.get("conversation.members.updated")?.({ conversation_id: "g1", revision: 2 }))
    await act(async () => finish({ versions: { "group:g1": 1 }, removed: [] }))
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(2))
    expect(mocks.apply.mock.calls.filter((call) => call[1].length > 0)).toHaveLength(1)
    expect(mocks.apply.mock.calls.at(-1)?.[0].versions["group:g1"]).toBe(2)
  })

  it("只刷新已加载用户，应用变更可发现新应用，不拦截话题状态事件", async () => {
    mocks.data.usersById = { user1: { id: "user1" } }
    mocks.resolve.mockResolvedValue({ versions: {}, removed: [] })
    render(<ClientEntityRealtimeSync />)
    act(() => {
      mocks.handlers.get("user.profile.updated")?.({ user_id: "stranger", revision: 1 })
      mocks.handlers.get("user.profile.updated")?.({ user_id: "user1", revision: 1 })
      mocks.handlers.get("app.profile.updated")?.({ app_id: "app1", revision: 1 })
      mocks.handlers.get("conversation.updated")?.({ conversation_id: "topic1", reason: "topic.read_state.updated" })
    })
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))
    expect(mocks.resolve.mock.calls[0]?.[0]).toEqual([{ type: "user", id: "user1" }, { type: "app", id: "app1" }])
  })

  it("切账号后丢弃进行中的旧资料响应", async () => {
    let finish!: (value: unknown) => void
    mocks.resolve.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const view = render(<ClientEntityRealtimeSync />)
    act(() => mocks.handlers.get("conversation.members.updated")?.({ conversation_id: "g1", revision: 1 }))
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))
    mocks.data.me = { id: "other" }
    view.rerender(<ClientEntityRealtimeSync />)
    await act(async () => finish({ versions: { "group:g1": 1 }, removed: [] }))
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it("目录集合通知合并刷新，不受陌生用户过滤影响，并补追进行中的新增事件", async () => {
    let finish!: () => void
    mocks.refresh.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<ClientEntityRealtimeSync />)
    act(() => {
      mocks.handlers.get("contact.directory.updated")?.({ scope: "users", revision: 1 })
      mocks.handlers.get("contact.directory.updated")?.({ scope: "apps", revision: 1 })
    })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))
    act(() => mocks.handlers.get("contact.directory.updated")?.({ scope: "users", revision: 1 }))
    await act(async () => finish())
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2))
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it("切账号后，旧目录恢复完成不能触发新账号实体对账", async () => {
    let finish!: () => void
    mocks.refresh.mockResolvedValueOnce(undefined).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    mocks.resolve.mockResolvedValue({ versions: {}, removed: [] })
    mocks.data.contactGroups = [{ id: "old-group", joined: true }]
    mocks.realtime.ready = true
    const view = render(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))
    mocks.realtime.ready = false
    view.rerender(<ClientEntityRealtimeSync />)
    mocks.realtime.ready = true
    view.rerender(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2))
    mocks.data.me = { id: "other" }
    mocks.data.contactGroups = [{ id: "new-group", joined: true }]
    view.rerender(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(2))
    await act(async () => finish())
    expect(mocks.resolve).toHaveBeenCalledTimes(2)
    expect(mocks.resolve.mock.calls[1]?.[0]).toEqual([{ type: "group", id: "new-group" }])
  })

  it("首次对账只刷新目录，不强制重拉已加载的全员资料和应用", async () => {
    mocks.data.usersById = Object.fromEntries(Array.from({ length: 1322 }, (_, i) => [`user-${i}`, { id: `user-${i}` }]))
    mocks.data.contactApps = [{ id: "app1" }]
    mocks.realtime.ready = true
    render(<ClientEntityRealtimeSync />)
    await act(async () => undefined)
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({ forceUsers: false })
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it("重连和回前台同时发生时合并对账，不重复刷新资料", async () => {
    let finish!: () => void
    mocks.refresh.mockResolvedValueOnce(undefined).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    mocks.resolve.mockResolvedValue({ versions: {}, removed: [] })
    mocks.data.contactGroups = [{ id: "group", joined: true }]
    mocks.realtime.ready = true
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    const view = render(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))
    mocks.realtime.ready = false
    view.rerender(<ClientEntityRealtimeSync />)
    mocks.realtime.ready = true
    view.rerender(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2))
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await act(async () => finish())
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(2))
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
  })

  it("目录返回的新群立即对账权限，不依赖React提交目录状态的时序", async () => {
    mocks.realtime.ready = true
    mocks.refresh.mockResolvedValue([{ id: "joined", joined: true }, { id: "public", joined: false }])
    mocks.resolve.mockResolvedValue({ versions: {}, removed: [] })
    render(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith([{ type: "group", id: "joined" }]))
  })

  it("首次握手后台加载目录，重连只刷新一轮资料并对账群权限", async () => {
    mocks.data.contactApps = [{ id: "app1" }]
    mocks.data.usersById = Object.fromEntries(Array.from({ length: 1322 }, (_, i) => [`user-${i}`, { id: `user-${i}` }]))
    mocks.data.contactGroups = [{ id: "g1", joined: true }]
    mocks.data.conversations = [{ id: "g2", type: "group" }]
    mocks.resolve.mockResolvedValue({ versions: {}, removed: [] })
    const view = render(<ClientEntityRealtimeSync />)
    mocks.realtime.ready = true
    view.rerender(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalled())
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({ forceUsers: false })
    expect(mocks.resolve.mock.calls[0]?.[0]).toEqual([{ type: "group", id: "g1" }, { type: "group", id: "g2" }])
    mocks.realtime.ready = false
    view.rerender(<ClientEntityRealtimeSync />)
    mocks.realtime.ready = true
    view.rerender(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(2))
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
    expect(mocks.refresh).toHaveBeenCalledWith({ forceUsers: true })
    expect(mocks.refresh.mock.invocationCallOrder[1]).toBeLessThan(mocks.resolve.mock.invocationCallOrder[1]!)
    expect(mocks.resolve.mock.calls[1]?.[0]).toEqual([{ type: "group", id: "g1" }, { type: "group", id: "g2" }])
  })
})
