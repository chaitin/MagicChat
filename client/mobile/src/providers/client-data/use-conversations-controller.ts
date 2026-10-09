import { useCallback, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { AuthenticatedTarget } from "@/core/server-target"
import { conversationManager } from "@/data/conversations"
import { measureMobilePerf } from "@/diagnostics/mobile-perf"
import { projectConversationsSnapshot } from "@/data/manager-query-projector"
import { conversationsQueryOptions } from "@/data/query"
import { hydrateClientConversationUsers, toError } from "./helpers"
import { subscribeCoalescedSnapshot, useManagerQueryBridge } from "./manager-query-bridge"
import { useManagerPolling } from "./use-manager-polling"
import type { ContactApp, ContactUser } from "@/core/models"

export function useConversationsController(target: AuthenticatedTarget, enabled: boolean, poll: number | false, apps: ContactApp[], users: Readonly<Record<string, ContactUser>>, onError: (error: unknown) => void) {
  const queryClient = useQueryClient(); const query = useQuery({ ...conversationsQueryOptions(target), enabled: false })
  const [refreshing, setRefreshing] = useState(false); const [refreshError, setRefreshError] = useState<Error | null>(null)
  const getSnapshot = useCallback(() => conversationManager.list(target), [target])
  const subscribe = useCallback((listener: (value: Awaited<ReturnType<typeof conversationManager.list>>) => void) =>
    subscribeCoalescedSnapshot(
      (onChange) => conversationManager.subscribe(target, onChange),
      () => conversationManager.list(target),
      listener
    ), [target])
  const project = useCallback((client: Parameters<typeof projectConversationsSnapshot>[0], snapshot: Awaited<ReturnType<typeof conversationManager.list>>) => projectConversationsSnapshot(client, target, snapshot), [target])
  const bridge = useManagerQueryBridge({ enabled, getSnapshot, project, queryClient, subscribe })
  const refresh = useCallback(async () => { setRefreshing(true); try { await conversationManager.refresh(target); setRefreshError(null) } catch (e) { const error = toError(e, "加载会话失败"); setRefreshError(error); onError(error); throw error } finally { setRefreshing(false) } }, [onError, target])
  const pollRefresh = useCallback(async (signal: AbortSignal) => { try { await conversationManager.refresh(target, { signal }); setRefreshError(null) } catch (e) { if (signal.aborted) return; const error = toError(e, "加载会话失败"); setRefreshError(error); onError(error) } }, [onError, target])
  useManagerPolling(enabled, poll, pollRefresh)
  const raw = useMemo(() => bridge.data ?? query.data ?? [], [bridge.data, query.data])
  const appsById = useMemo(() => Object.fromEntries(apps.map((app) => [app.id, app])), [apps])
  const data = useMemo(() => measureMobilePerf("conversations.hydrate_ms", () => raw.map((value) => hydrateClientConversationUsers(value, apps, users, appsById))), [apps, appsById, raw, users])
  return { data, rawData: raw, localReady: bridge.localReady, refreshState: refreshing, error: bridge.error ?? refreshError, refresh }
}
