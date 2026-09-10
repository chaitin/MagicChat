import { describe, expect, it } from "vitest"

import { quotaUsagePercent, type PushServer } from "@/lib/server-model"

const server: PushServer = {
  createdAt: "2026-09-09T00:00:00Z",
  dailyLimit: 100_000,
  id: "server-id",
  name: "生产环境一号",
  revision: 1,
  status: "active",
  todayUsage: 38_642,
}

describe("push server model", () => {
  it("calculates quota progress", () => {
    expect(quotaUsagePercent(server)).toBe(39)
  })

  it("caps quota progress at one hundred percent", () => {
    expect(quotaUsagePercent({ ...server, todayUsage: 200_000 })).toBe(100)
  })
})
