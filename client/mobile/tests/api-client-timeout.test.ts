import assert from "node:assert/strict"
import test from "node:test"

import { createApiClient } from "@/data/api-client"

test(
  "rejects on timeout even when fetch ignores abort",
  { timeout: 200 },
  async () => {
    const fetcher = () => new Promise<Response>(() => {})
    const client = createApiClient("https://unreachable.example", fetcher)

    await assert.rejects(
      client.request("/api/client/info", {
        errorMessage: "获取服务器信息失败",
        timeoutMs: 20,
      }),
      /获取服务器信息失败：请求超时/
    )
  }
)

test(
  "rejects on timeout when reading the response body never finishes",
  { timeout: 200 },
  async () => {
    const fetcher = async () =>
      ({
        headers: { get: () => "application/json" },
        json: () => new Promise<never>(() => {}),
        ok: true,
      }) as unknown as Response
    const client = createApiClient("https://unreachable.example", fetcher)

    await assert.rejects(
      client.request("/api/client/info", {
        errorMessage: "获取服务器信息失败",
        timeoutMs: 20,
      }),
      /获取服务器信息失败：请求超时/
    )
  }
)

test(
  "rejects immediately when the parent aborts and fetch ignores abort",
  { timeout: 300 },
  async () => {
    const fetcher = () => new Promise<Response>(() => {})
    const client = createApiClient("https://unreachable.example", fetcher)
    const controller = new AbortController()
    const request = client.request("/api/client/info", {
      errorMessage: "获取服务器信息失败",
      signal: controller.signal,
      timeoutMs: 200,
    })

    controller.abort()

    await assert.rejects(request, { name: "AbortError" })
  }
)
