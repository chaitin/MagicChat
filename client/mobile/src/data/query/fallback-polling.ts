export const FALLBACK_POLLING_INTERVAL_MS = 15_000
export const PASSIVE_CONTACTS_POLLING_INTERVAL_MS = 60_000
export const PASSIVE_PROJECTS_POLLING_INTERVAL_MS = 5 * 60_000

export function getRealtimeAwarePollingInterval(
  realtimeReady: boolean,
  connectedInterval: false | number = false
) {
  return realtimeReady ? connectedInterval : FALLBACK_POLLING_INTERVAL_MS
}

export function getClientDataPollingIntervals(realtimeReady: boolean) {
  return {
    contacts: getRealtimeAwarePollingInterval(
      realtimeReady,
      PASSIVE_CONTACTS_POLLING_INTERVAL_MS
    ),
    conversations: getRealtimeAwarePollingInterval(realtimeReady),
    projects: getRealtimeAwarePollingInterval(
      realtimeReady,
      PASSIVE_PROJECTS_POLLING_INTERVAL_MS
    ),
  }
}
