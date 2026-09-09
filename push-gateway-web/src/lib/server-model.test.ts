import { describe, expect, it } from "vitest"

import {
  createMockServer,
  maskServerKey,
  MOCK_SERVERS,
  quotaUsagePercent,
  rotateMockServerKey,
} from "@/lib/server-model"

describe("push server model", () => {
  it("creates a unique-looking server key without placing it in the record", () => {
    const result = createMockServer({
      dailyLimit: 10_000,
      name: " 测试服务器 ",
    })
    expect(result.server.name).toBe("测试服务器")
    expect(result.server.dailyLimit).toBe(10_000)
    expect(result.server).not.toHaveProperty("key")
    expect(result.key).toMatch(/^mcps_srv_[a-z0-9]+_[a-z0-9]+$/)
  })

  it("rotates only the key fingerprint", () => {
    const original = MOCK_SERVERS[0]
    const result = rotateMockServerKey(original)
    expect(result.server.id).toBe(original.id)
    expect(result.server.keyFingerprint).not.toBe(original.keyFingerprint)
    expect(result.key).toContain(original.id)
  })

  it("masks stored keys while preserving a recognizable prefix and suffix", () => {
    const key = "mcps_srv_demo_abcdefghijklmnopqrstuvwxyz"
    const masked = maskServerKey(key)
    expect(masked).toMatch(/^mcps_srv_dem/)
    expect(masked).toMatch(/wxyz$/)
    expect(masked).not.toContain("abcdefghijklmnopqrstuv")
  })

  it("caps quota progress at one hundred percent", () => {
    expect(quotaUsagePercent({ ...MOCK_SERVERS[0], todayUsage: 200_000 })).toBe(
      100
    )
  })
})
