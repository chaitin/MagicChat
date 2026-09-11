import { describe, expect, it } from "vitest"

import {
  formatActivityTime,
  formatDocumentModifiedTime,
} from "@/lib/activity-time"

describe("formatActivityTime", () => {
  const now = new Date("2026-07-03T20:00:00")

  it("formats activity times according to validity and local day", () => {
    expect(formatActivityTime("2026-07-03T16:05:00", now)).toBe("16:05")
    expect(formatActivityTime("2026-07-02T16:05:00", now)).toBe("07-02")
    expect(formatActivityTime(null, now)).toBe("")
    expect(formatActivityTime("not-a-date", now)).toBe("")
  })

  it("formats document modification times with a full local timestamp", () => {
    expect(formatDocumentModifiedTime("2025-12-31T09:08:00")).toBe(
      "修改于 2025-12-31 09:08"
    )
    expect(formatDocumentModifiedTime("2026-07-03T16:05:00")).toBe(
      "修改于 2026-07-03 16:05"
    )
  })
})
