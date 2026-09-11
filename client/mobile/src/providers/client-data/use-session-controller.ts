import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { AuthenticatedTarget } from "@/core/server-target"
import { currentUserQueryOptions } from "@/data/query"
import { createSessionBootstrapOperations, sessionBootstrapCoordinator } from "@/features/bootstrap/session-bootstrap"
import { isUnauthorizedError } from "@/data/api-client"

export function useSessionController(target: AuthenticatedTarget, enabled: boolean, invalidateSession: () => Promise<void>) {
  const queryClient = useQueryClient()
  const query = useQuery({ ...currentUserQueryOptions(target), enabled })
  const invalidated = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const snapshot = useSyncExternalStore(
    useCallback((listener) => enabled ? sessionBootstrapCoordinator.subscribe(target, listener) : () => undefined, [enabled, target]),
    useCallback(() => sessionBootstrapCoordinator.getSnapshot(target), [target]),
    useCallback(() => sessionBootstrapCoordinator.getSnapshot(target), [target]))
  const invalidateOnce = useCallback(() => {
    if (!invalidated.current) { invalidated.current = true; void invalidateSession() }
  }, [invalidateSession])
  const unauthorized = useCallback((error: unknown) => {
    if (isUnauthorizedError(error)) invalidateOnce()
  }, [invalidateOnce])
  useEffect(() => { invalidated.current = false }, [target])
  useEffect(() => {
    if (!enabled) return
    void sessionBootstrapCoordinator.start(target, createSessionBootstrapOperations({ queryClient, target }), { onUnauthorized: invalidateOnce }).catch(unauthorized)
  }, [enabled, invalidateOnce, queryClient, target, unauthorized])
  useEffect(() => unauthorized(query.error), [query.error, unauthorized])
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try { const result = await query.refetch(); if (result.error) throw result.error }
    finally { setRefreshing(false) }
  }, [query])
  return { data: enabled ? query.data : undefined, localReady: query.data !== undefined, refreshState: refreshing, error: enabled ? query.error : null, refresh, bootstrapSnapshot: snapshot, unauthorized }
}
