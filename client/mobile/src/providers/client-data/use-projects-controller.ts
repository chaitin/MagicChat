import { useCallback, useState } from "react"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import type { AuthenticatedTarget } from "@/core/server-target"
import { projectManager } from "@/data/projects"
import { projectProjectsSnapshot } from "@/data/manager-query-projector"
import { projectsQueryOptions } from "@/data/query"
import { toError } from "./helpers"
import { useManagerQueryBridge } from "./manager-query-bridge"
import { useManagerPolling } from "./use-manager-polling"

export function useProjectsController(target: AuthenticatedTarget, enabled: boolean, poll: number | false, onError: (error: unknown) => void) {
  const queryClient = useQueryClient(); useInfiniteQuery({ ...projectsQueryOptions(target), enabled: false })
  const [refreshing, setRefreshing] = useState(false); const [loadingMore, setLoadingMore] = useState(false); const [refreshError, setRefreshError] = useState<Error | null>(null)
  const getSnapshot = useCallback(() => projectManager.getSnapshot(target), [target])
  const subscribe = useCallback((listener: (snapshot: Awaited<ReturnType<typeof projectManager.getSnapshot>>) => void) => projectManager.subscribe(target, listener), [target])
  const project = useCallback((client: Parameters<typeof projectProjectsSnapshot>[0], snapshot: Awaited<ReturnType<typeof projectManager.getSnapshot>>) => projectProjectsSnapshot(client, target, snapshot), [target])
  const bridge = useManagerQueryBridge({ enabled, getSnapshot, project, queryClient, subscribe })
  const run = useCallback(async () => { try { const value = await projectManager.refresh(target); setRefreshError(null); return value } catch (e) { const error = toError(e, "加载项目列表失败"); setRefreshError(error); onError(error); throw error } }, [onError, target])
  const refresh = useCallback(async () => { setRefreshing(true); try { await run() } finally { setRefreshing(false) } }, [run])
  const pollRefresh = useCallback(async () => { try { await run() } catch {} }, [run]); useManagerPolling(enabled, poll, pollRefresh)
  const loadMore = useCallback(async () => { if (!bridge.data?.hasMore || loadingMore) return; setLoadingMore(true); try { await projectManager.loadMore(target); setRefreshError(null) } catch (e) { const error = toError(e, "加载更多项目失败"); setRefreshError(error); onError(error); throw error } finally { setLoadingMore(false) } }, [bridge.data?.hasMore, loadingMore, onError, target])
  return { data: bridge.data?.projects ?? [], personalProject: bridge.data?.personalProject ?? null, hasMore: bridge.data?.hasMore ?? false, localReady: bridge.localReady, refreshState: refreshing, loadingMore, error: bridge.error ?? refreshError, refresh, loadMore }
}
