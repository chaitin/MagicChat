import assert from "node:assert/strict"
import test from "node:test"

import {
  FALLBACK_POLLING_INTERVAL_MS,
  getClientDataPollingIntervals,
  getRealtimeAwarePollingInterval,
  PASSIVE_CONTACTS_POLLING_INTERVAL_MS,
  PASSIVE_PROJECTS_POLLING_INTERVAL_MS,
} from "../src/data/query/fallback-polling.ts"

test("disables realtime-backed polling while synchronization is ready", () => {
  assert.equal(getRealtimeAwarePollingInterval(true), false)
})

test("uses a low-frequency fallback while realtime is unavailable", () => {
  assert.equal(
    getRealtimeAwarePollingInterval(false),
    FALLBACK_POLLING_INTERVAL_MS
  )
  assert.equal(FALLBACK_POLLING_INTERVAL_MS, 15_000)
})

test("keeps passive data fresh at a lower rate while realtime is ready", () => {
  assert.equal(
    getRealtimeAwarePollingInterval(
      true,
      PASSIVE_CONTACTS_POLLING_INTERVAL_MS
    ),
    60_000
  )
  assert.equal(
    getRealtimeAwarePollingInterval(
      true,
      PASSIVE_PROJECTS_POLLING_INTERVAL_MS
    ),
    300_000
  )
})

test("maps realtime state to every client data polling policy", () => {
  assert.deepEqual(getClientDataPollingIntervals(false), {
    contacts: 15_000,
    conversations: 15_000,
    projects: 15_000,
  })
  assert.deepEqual(getClientDataPollingIntervals(true), {
    contacts: 60_000,
    conversations: false,
    projects: 300_000,
  })
})
