import { AuthFailure } from "../shared/auth.ts"
import type { ReleasePlatform, UpdateInfo } from "../shared/desktop"
import { parseUpdateInfo } from "./update-policy.ts"

const VERSION_URL = "https://jiying.chat/releases/version.json"
const MAX_VERSION_RESPONSE_BYTES = 64 * 1024

export async function fetchUpdateInfo({
  fetcher,
  platform,
  currentVersion,
  currentBuildId,
  timeoutMs = 5_000,
}: {
  fetcher: (url: string, init: RequestInit) => Promise<Response>
  platform: ReleasePlatform
  currentVersion: string
  currentBuildId: number
  timeoutMs?: number
}): Promise<UpdateInfo> {
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    const response = await waitForResponse(
      fetcher(VERSION_URL, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal,
      }),
      signal,
    )
    if (!response.ok) {
      throw new AuthFailure("update_check_failed", `检查更新失败（HTTP ${response.status}）`)
    }
    return parseUpdateInfo(
      await readLimitedJson(response, signal),
      platform,
      currentVersion,
      currentBuildId,
    )
  } catch (error) {
    if (error instanceof AuthFailure) throw error
    throw new AuthFailure(
      "update_check_failed",
      signal.aborted ? "检查更新超时，请稍后重试" : "无法检查更新，请稍后重试",
    )
  }
}

async function waitForResponse(request: Promise<Response>, signal: AbortSignal): Promise<Response> {
  let onAbort: () => void = () => undefined
  const expired = new Promise<never>((_, reject) => {
    onAbort = () => reject(new AuthFailure("update_check_failed", "检查更新超时，请稍后重试"))
    if (signal.aborted) onAbort()
    else signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    return await Promise.race([request, expired])
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}

async function readLimitedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new AuthFailure("invalid_update_info", "更新信息为空")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  const onAbort = () => {
    void reader.cancel().catch(() => undefined)
  }
  let onAbortListener: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    const rejectOnAbort = () => {
      onAbort()
      reject(new AuthFailure("update_check_failed", "检查更新超时，请稍后重试"))
    }
    if (signal.aborted) rejectOnAbort()
    else signal.addEventListener("abort", rejectOnAbort, { once: true })
    onAbortListener = rejectOnAbort
  })
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted])
      if (signal.aborted) throw new AuthFailure("update_check_failed", "检查更新超时，请稍后重试")
      if (done) break
      total += value.byteLength
      if (total > MAX_VERSION_RESPONSE_BYTES) {
        throw new AuthFailure("invalid_update_info", "更新信息过大")
      }
      chunks.push(value)
    }
  } catch (error) {
    onAbort()
    throw error
  } finally {
    if (onAbortListener) signal.removeEventListener("abort", onAbortListener)
    try {
      reader.releaseLock()
    } catch {
      // A cancelled read can still be settling after the timeout.
    }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new AuthFailure("invalid_update_info", "更新信息格式不正确")
  }
}
