import { act, render, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ClientEntityRealtimeSync } from "@/components/client-entity-realtime-sync"

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => void>(),
  resolve: vi.fn(), apply: vi.fn(), refresh: vi.fn(),
  data: { me: { id: "me" }, contactApps: [] as { id: string }[], contactGroups: [] as { id: string; joined: boolean }[], conversations: [] as { id: string; type: string }[], usersById: {} as Record<string, unknown> },
  realtime: { ready: false },
  subscribe: vi.fn((event: string, handler: (payload: unknown) => void) => {
    mocks.handlers.set(event, handler)
    return () => { mocks.handlers.delete(event) }
  }),
}))
vi.mock("@/lib/client-data-context", () => ({ useClientData: () => ({ ...mocks.data, applyEntitySnapshot: mocks.apply, refreshContacts: mocks.refresh }) }))
vi.mock("@/lib/realtime-context", () => ({ useRealtime: () => ({ ...mocks.realtime, subscribeRealtimeEvent: mocks.subscribe }) }))
vi.mock("@/lib/client-api/entity-sync", () => ({ resolveClientEntities: (entities: unknown) => mocks.resolve(entities) }))

describe("实体实时同步", () => {
  beforeEach(() => {
    mocks.handlers.clear(); mocks.resolve.mockReset(); mocks.apply.mockReset(); mocks.refresh.mockReset().mockResolvedValue(undefined)
    mocks.data = { me: { id: "me" }, contactApps: [], contactGroups: [], conversations: [], usersById: {} }
    mocks.realtime.ready = false
  })
  afterEach(() => vi.restoreAllMocks())

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
    mocks.refresh.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    mocks.resolve.mockResolvedValue({ versions: {}, removed: [] })
    mocks.realtime.ready = true
    const view = render(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))
    mocks.data.me = { id: "other" }
    view.rerender(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1))
    await act(async () => finish())
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
    expect(mocks.resolve.mock.calls[0]?.[0]).toEqual([{ type: "user", id: "other" }])
  })

  it("握手恢复时先重新发现目录，再对账已缓存群权限和用户头像", async () => {
    mocks.data.contactApps = [{ id: "app1" }]
    mocks.data.contactGroups = [{ id: "g1", joined: true }]
    mocks.data.conversations = [{ id: "g2", type: "group" }]
    mocks.resolve.mockResolvedValue({ versions: {}, removed: [] })
    const view = render(<ClientEntityRealtimeSync />)
    mocks.realtime.ready = true
    view.rerender(<ClientEntityRealtimeSync />)
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalled())
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(mocks.resolve.mock.invocationCallOrder[0]!)
    expect(mocks.resolve.mock.calls[0]?.[0]).toEqual([
      { type: "user", id: "me" }, { type: "app", id: "app1" }, { type: "group", id: "g1" }, { type: "group", id: "g2" },
    ])
  })
})
