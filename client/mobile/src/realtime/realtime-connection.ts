import type { AuthenticatedTarget } from "@/core/server-target"

export type ReadyRealtimeClient = {
  connect: () => void
  disconnect: () => void
  getSnapshot: () => { ready: boolean }
  subscribe: (listener: () => void) => () => void
}

export type RealtimeClientRecord<TClient extends ReadyRealtimeClient> = {
  client: TClient
  targetKey: string
}

export function createRealtimeTargetKey(target: AuthenticatedTarget) {
  return `${target.id}\u0000${target.url}\u0000${target.userId}`
}

export function waitForRealtimeClient<TClient extends ReadyRealtimeClient>(
  clientRef: { current: RealtimeClientRecord<TClient> | null },
  targetKey: string,
  timeoutMs: number
) {
  const current = clientRef.current
  if (current?.targetKey === targetKey) return Promise.resolve(current.client)

  return new Promise<TClient>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      const next = clientRef.current
      if (next?.targetKey === targetKey) {
        resolve(next.client)
      } else if (Date.now() >= deadline) {
        reject(new Error("实时连接初始化超时"))
      } else {
        setTimeout(check, 25)
      }
    }
    check()
  })
}

export function waitForClientReady(
  client: ReadyRealtimeClient,
  timeoutMs: number
) {
  if (client.getSnapshot().ready) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      unsubscribe()
      if (error) reject(error)
      else resolve()
    }
    const unsubscribe = client.subscribe(() => {
      if (client.getSnapshot().ready) finish()
    })
    const timeout = setTimeout(
      () => finish(new Error("实时连接超时")),
      timeoutMs
    )
    if (client.getSnapshot().ready) finish()
  })
}
