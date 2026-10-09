import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { AuthenticatedTarget } from "@/core/server-target"
import type { ContactUser } from "@/core/models"
import { contactManager } from "@/data/contacts"
import { projectContactsSnapshot } from "@/data/manager-query-projector"
import { contactsQueryOptions } from "@/data/query"
import { collectContactUserIds, hydrateContacts, toError } from "./helpers"
import { useManagerQueryBridge } from "./manager-query-bridge"
import { useManagerPolling } from "./use-manager-polling"

const EMPTY_USER_PROFILES: Record<string, ContactUser> = {}

export function useContactsController(target: AuthenticatedTarget, enabled: boolean, poll: number | false, onError: (error: unknown) => void) {
  const queryClient = useQueryClient(); const query = useQuery({ ...contactsQueryOptions(target), enabled: false })
  const [refreshing, setRefreshing] = useState(false); const [refreshError, setRefreshError] = useState<Error | null>(null)
  const getSnapshot = useCallback(() => contactManager.getSnapshot(target), [target])
  const subscribe = useCallback((listener: (snapshot: Awaited<ReturnType<typeof contactManager.getSnapshot>>) => void) => contactManager.subscribe(target, listener), [target])
  const project = useCallback((client: Parameters<typeof projectContactsSnapshot>[0], snapshot: Awaited<ReturnType<typeof contactManager.getSnapshot>>) => projectContactsSnapshot(client, target, snapshot), [target])
  const bridge = useManagerQueryBridge({ enabled, getSnapshot, project, queryClient, subscribe })
  const snapshot = bridge.data
  const ensureUsers = useCallback(async (ids: string[]) => { try { await contactManager.ensureUsers(target, ids); setRefreshError(null) } catch (e) { const error = toError(e, "加载用户资料失败"); setRefreshError(error); onError(error); throw error } }, [onError, target])
  const refresh = useCallback(async () => { setRefreshing(true); try { const value = await contactManager.refresh(target); setRefreshError(null); await ensureUsers(collectContactUserIds(value.directory)) } catch (e) { const error = toError(e, "加载通讯录失败"); setRefreshError(error); onError(error); throw error } finally { setRefreshing(false) } }, [ensureUsers, onError, target])
  const pollRefresh = useCallback(async () => { try { await contactManager.refresh(target); setRefreshError(null) } catch (e) { const error = toError(e, "加载通讯录失败"); setRefreshError(error); onError(error) } }, [onError, target])
  useManagerPolling(enabled, poll, pollRefresh)
  const directory = snapshot?.directory ?? query.data
  const required = collectContactUserIds(directory)
  useEffect(() => {
    if (!enabled) return
    const ids = collectContactUserIds(directory)
    if (ids.length) queueMicrotask(() => void ensureUsers(ids).catch(() => undefined))
  }, [directory, enabled, ensureUsers])
  const usersById = snapshot?.usersById ?? EMPTY_USER_PROFILES; const unavailable = snapshot?.unavailableUserIds ?? new Set<string>()
  const profilesReady = required.every((id) => Boolean(usersById[id]) || unavailable.has(id))
  const data = useMemo(() => hydrateContacts(directory, usersById), [directory, usersById])
  return { data, directory, usersById, profilesReady, localReady: bridge.localReady, refreshState: refreshing, error: bridge.error ?? refreshError, refresh, ensureUsers }
}
