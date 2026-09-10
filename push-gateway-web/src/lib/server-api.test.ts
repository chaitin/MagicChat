import { afterEach, describe, expect, it, vi } from "vitest"

import { listServers } from "@/lib/server-api"

describe("push server API", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("normalizes a null legacy server list to an empty array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ success: true, data: { servers: null } })
      )
    )

    await expect(listServers()).resolves.toEqual([])
  })
})
