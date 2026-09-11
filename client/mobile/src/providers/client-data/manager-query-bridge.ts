import type { QueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

export type BridgeState<T> = { data?: T; error: Error | null; localReady: boolean }

export function startManagerQueryBridge<T>({ generation, getSnapshot, onState, project, queryClient, subscribe }: {
  generation: number; getSnapshot: (signal: AbortSignal) => Promise<T>; onState: (state: BridgeState<T>, generation: number) => void
  project: (queryClient: Pick<QueryClient, "setQueryData">, snapshot: T) => void
  queryClient: Pick<QueryClient, "setQueryData">; subscribe: (listener: (snapshot: T) => void) => () => void
}) {
  const abort = new AbortController()
  const apply = (data: T) => {
    if (abort.signal.aborted) return
    project(queryClient, data); onState({ data, error: null, localReady: true }, generation)
  }
  const unsubscribe = subscribe(apply)
  void getSnapshot(abort.signal).then(apply, (value: unknown) => {
    if (!abort.signal.aborted) onState({ error: value instanceof Error ? value : new Error("加载本地缓存失败"), localReady: true }, generation)
  })
  return () => { abort.abort(); unsubscribe() }
}

export function useManagerQueryBridge<T>({ enabled, getSnapshot, project, queryClient, subscribe }: {
  enabled: boolean; getSnapshot: (signal: AbortSignal) => Promise<T>; queryClient: QueryClient
  project: (queryClient: Pick<QueryClient, "setQueryData">, snapshot: T) => void
  subscribe: (listener: (snapshot: T) => void) => () => void
}) {
  const generation = useRef(0)
  const [state, setState] = useState<BridgeState<T>>({ error: null, localReady: false })
  useEffect(() => {
    const current = ++generation.current
    queueMicrotask(() => { if (generation.current === current) setState({ error: null, localReady: false }) })
    if (!enabled) return
    return startManagerQueryBridge({ generation: current, getSnapshot, project, queryClient, subscribe,
      onState: (next, resultGeneration) => { if (generation.current === resultGeneration) setState(next) },
    })
  }, [enabled, getSnapshot, project, queryClient, subscribe])
  return state
}
