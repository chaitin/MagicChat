import assert from "node:assert/strict"
import test from "node:test"
import type { ClientConversation } from "@/core/models"
import { createMessageBootstrap } from "@/features/bootstrap/message-bootstrap"

test("历史预热对照开关仅在诊断包生效，启动本身不做网络同步", async () => {
  const previousPerf = process.env.EXPO_PUBLIC_MOBILE_PERF
  const previousSkip = process.env.EXPO_PUBLIC_MOBILE_SKIP_HISTORY_WARMUP
  try {
    for (const [perf, skip, expectedReads] of [["0", "1", 4], ["1", "0", 4], ["1", "1", 0]] as const) {
      process.env.EXPO_PUBLIC_MOBILE_PERF = perf
      process.env.EXPO_PUBLIC_MOBILE_SKIP_HISTORY_WARMUP = skip
      const conversations = Array.from({ length: 4 }, (_, index) => ({ id: `c${index}`, lastMessageSeq: 1 })) as ClientConversation[]
      const page = { messages: [], page: { hasMoreBefore: false, newestSeq: 0, oldestSeq: 0 } }
      let reads = 0
      const run = createMessageBootstrap({
        listLocalConversations: async () => conversations,
        readLatestPage: async () => { reads += 1; return page },
      }, 30_000, 0)
      await run({ id: "server", url: "https://example.test", userId: "user" })
      assert.equal(reads, expectedReads)
    }
  } finally {
    if (previousPerf === undefined) delete process.env.EXPO_PUBLIC_MOBILE_PERF
    else process.env.EXPO_PUBLIC_MOBILE_PERF = previousPerf
    if (previousSkip === undefined) delete process.env.EXPO_PUBLIC_MOBILE_SKIP_HISTORY_WARMUP
    else process.env.EXPO_PUBLIC_MOBILE_SKIP_HISTORY_WARMUP = previousSkip
  }
})
