import type { AuthenticatedTarget } from "@/data/query"
import {
  fetchResourceReadUrls,
  type ResourceReadUrl,
} from "@/data/resources/resource-read-url-api"

type DeferredReadUrl = {
  promise: Promise<ResourceReadUrl>
  reject: (error: unknown) => void
  resolve: (value: ResourceReadUrl) => void
}

type ReadUrlBatch = {
  requests: Map<string, DeferredReadUrl>
  session: AuthenticatedTarget
}

const pendingBatches = new Map<string, ReadUrlBatch>()

export function requestResourceReadUrl(
  session: AuthenticatedTarget,
  fileId: string
) {
  const batchKey = createBatchKey(session)
  let batch = pendingBatches.get(batchKey)

  if (!batch) {
    batch = { requests: new Map(), session }
    pendingBatches.set(batchKey, batch)
    const scheduledBatch = batch
    void Promise.resolve().then(() => flushBatch(batchKey, scheduledBatch))
  }

  const existing = batch.requests.get(fileId)
  if (existing) return existing.promise

  let resolve!: (value: ResourceReadUrl) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<ResourceReadUrl>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  batch.requests.set(fileId, { promise, reject, resolve })
  return promise
}

async function flushBatch(batchKey: string, batch: ReadUrlBatch) {
  if (pendingBatches.get(batchKey) === batch) {
    pendingBatches.delete(batchKey)
  }

  const fileIds = Array.from(batch.requests.keys())

  try {
    const values = await fetchResourceReadUrls(batch.session.url, fileIds)
    const valuesById = new Map(values.map((value) => [value.fileId, value]))

    for (const [fileId, request] of batch.requests) {
      const value = valuesById.get(fileId)
      if (value) {
        request.resolve(value)
      } else {
        request.reject(new Error(`服务器没有返回文件 ${fileId} 的访问地址`))
      }
    }
  } catch (error: unknown) {
    for (const request of batch.requests.values()) {
      request.reject(error)
    }
  }
}

function createBatchKey(session: AuthenticatedTarget) {
  return `${session.id}\n${session.url}\n${session.userId}`
}
