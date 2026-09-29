import assert from "node:assert/strict"
import test from "node:test"
import { AuthFailure } from "../src/shared/auth.ts"
import { fetchUpdateInfo } from "../src/main/update-check.ts"

const current = {
  platform: "windows" as const,
  currentVersion: "2.0.0",
  currentBuildId: 20,
}

test("reads a normal version manifest", async () => {
  const result = await fetchUpdateInfo({
    ...current,
    fetcher: async (_url, init) => {
      assert.equal(init.redirect, "error")
      return new Response(
        JSON.stringify({
          windows: { build: 21, version: "2.0.1", url: "https://jiying.chat/releases/jiying.exe" },
        }),
      )
    },
  })
  assert.equal(result.updateAvailable, true)
})

test("body stream errors become a specific update-check error", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new Error("connection reset"))
    },
  })
  await assert.rejects(
    fetchUpdateInfo({ ...current, fetcher: async () => new Response(stream) }),
    (error: unknown) =>
      error instanceof AuthFailure &&
      error.code === "update_check_failed" &&
      error.message === "无法检查更新，请稍后重试",
  )
})

test("a stalled version body times out instead of leaving the check pending", async () => {
  const stream = new ReadableStream({ start() {} })
  await assert.rejects(
    fetchUpdateInfo({ ...current, fetcher: async () => new Response(stream), timeoutMs: 20 }),
    (error: unknown) =>
      error instanceof AuthFailure &&
      error.code === "update_check_failed" &&
      error.message === "检查更新超时，请稍后重试",
  )
})

test("a stalled request times out even if the fetcher ignores cancellation", async () => {
  await assert.rejects(
    fetchUpdateInfo({
      ...current,
      fetcher: () => new Promise<Response>(() => undefined),
      timeoutMs: 20,
    }),
    (error: unknown) =>
      error instanceof AuthFailure &&
      error.code === "update_check_failed" &&
      error.message === "检查更新超时，请稍后重试",
  )
})

test("invalid version JSON keeps a useful error instead of an internal IPC error", async () => {
  await assert.rejects(
    fetchUpdateInfo({ ...current, fetcher: async () => new Response("not-json") }),
    (error: unknown) => error instanceof AuthFailure && error.code === "invalid_update_info",
  )
})
