import { AppState } from "react-native"
import type { AuthenticatedTarget } from "@/core/server-target"

export const MOBILE_PERF_ENABLED = process.env.EXPO_PUBLIC_MOBILE_PERF === "1"

const SAMPLE_INTERVAL_MS = 100
const REPORT_INTERVAL_MS = 10_000
const LAG_THRESHOLD_MS = 50

type Sample = { count: number; total: number; max: number }
const samples = new Map<string, Sample>()
const conversationOpenStarts = new Map<string, { at: number; confirmed: boolean }>()
let recording = false

function conversationOpenKey(target: AuthenticatedTarget, conversationId: string) {
  return JSON.stringify([target.id, target.url, target.userId, conversationId])
}

export function recordConversationPressIn(target: AuthenticatedTarget, conversationId: string) {
  if (!MOBILE_PERF_ENABLED || !recording) return
  const now = performance.now()
  for (const [key, value] of conversationOpenStarts) {
    if (now - value.at > 30_000) conversationOpenStarts.delete(key)
  }
  conversationOpenStarts.set(conversationOpenKey(target, conversationId), { at: now, confirmed: false })
}

export function recordConversationNavigation(target: AuthenticatedTarget, conversationId: string) {
  if (!MOBILE_PERF_ENABLED || !recording) return
  const key = conversationOpenKey(target, conversationId)
  const current = conversationOpenStarts.get(key)
  conversationOpenStarts.set(key, { at: current?.at ?? performance.now(), confirmed: true })
}

export function recordConversationReady(target: AuthenticatedTarget, conversationId: string) {
  if (!MOBILE_PERF_ENABLED || !recording) return
  const key = conversationOpenKey(target, conversationId)
  const start = conversationOpenStarts.get(key)
  if (!start?.confirmed) return
  conversationOpenStarts.delete(key)
  const elapsed = performance.now() - start.at
  if (elapsed < 30_000) recordMobilePerf("conversation.open_to_ready_ms", elapsed)
}

export function recordMobilePerf(name: string, value = 0) {
  if (!MOBILE_PERF_ENABLED || !recording) return
  const sample = samples.get(name) ?? { count: 0, total: 0, max: 0 }
  sample.count += 1
  sample.total += value
  sample.max = Math.max(sample.max, value)
  samples.set(name, sample)
}

export function measureMobilePerf<T>(name: string, work: () => T): T {
  if (!MOBILE_PERF_ENABLED) return work()
  const startedAt = performance.now()
  try {
    return work()
  } finally {
    recordMobilePerf(name, performance.now() - startedAt)
  }
}

export function startMobilePerfMonitoring() {
  if (!MOBILE_PERF_ENABLED) return () => undefined

  let active = AppState.currentState === "active"
  recording = active
  let lastTick = performance.now()
  let lastReport = lastTick
  const subscription = AppState.addEventListener("change", (state) => {
    active = state === "active"
    recording = active
    lastTick = performance.now()
    lastReport = lastTick
    if (!active) {
      samples.clear()
      conversationOpenStarts.clear()
    }
  })
  const timer = setInterval(() => {
    const now = performance.now()
    if (active) {
      const lag = now - lastTick - SAMPLE_INTERVAL_MS
      if (lag >= LAG_THRESHOLD_MS) recordMobilePerf("js.lag_ms", lag)
      if (now - lastReport >= REPORT_INTERVAL_MS) {
        if (samples.size > 0) {
          const summary = Array.from(samples, ([name, sample]) =>
            `${name}:n=${sample.count},sum=${sample.total.toFixed(1)},max=${sample.max.toFixed(1)}`
          ).join(" ")
          console.info(`[mobile-perf] ${summary}`)
          samples.clear()
        }
        lastReport = now
      }
    }
    lastTick = now
  }, SAMPLE_INTERVAL_MS)

  return () => {
    clearInterval(timer)
    subscription.remove()
    recording = false
    samples.clear()
    conversationOpenStarts.clear()
  }
}
