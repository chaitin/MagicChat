import { randomUUID } from "node:crypto"
import { chmod, mkdir, open, rename, rm } from "node:fs/promises"
import path from "node:path"
import type { ReleasePlatform, UpdateInfo, UpdateProgress } from "../shared/desktop"
import { updateFileExtension } from "./update-policy.ts"

const MAX_UPDATE_BYTES = 2_000_000_000

export async function validateUpdateFile(
  filePath: string,
  platform: ReleasePlatform,
  expectedSize?: number,
): Promise<boolean> {
  try {
    const file = await open(filePath, "r")
    try {
      const status = await file.stat()
      const { size } = status
      if (
        !status.isFile() ||
        size <= 0 ||
        size > MAX_UPDATE_BYTES ||
        (expectedSize !== undefined && size !== expectedSize)
      ) {
        return false
      }
      if (platform === "windows") {
        if (size < 68) return false
        const dosHeader = Buffer.alloc(64)
        await file.read(dosHeader, 0, dosHeader.length, 0)
        if (dosHeader.toString("ascii", 0, 2) !== "MZ") return false
        const peOffset = dosHeader.readUInt32LE(60)
        if (peOffset < 64 || peOffset > 1_048_576 || peOffset + 4 > size) return false
        const signature = Buffer.alloc(4)
        await file.read(signature, 0, 4, peOffset)
        return signature.equals(Buffer.from([0x50, 0x45, 0, 0]))
      }
      if (platform === "macos") {
        if (size < 512) return false
        const trailer = Buffer.alloc(4)
        await file.read(trailer, 0, 4, size - 512)
        return trailer.toString("ascii") === "koly"
      }
      if (size < 11) return false
      const header = Buffer.alloc(11)
      await file.read(header, 0, header.length, 0)
      return (
        header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) &&
        header.toString("ascii", 8, 10) === "AI" &&
        header[10] === 2
      )
    } finally {
      await file.close()
    }
  } catch {
    return false
  }
}

export async function downloadUpdatePackage({
  update,
  directory,
  fetcher,
  onProgress,
  signal,
}: {
  update: UpdateInfo
  directory: string
  fetcher: (url: string, init: RequestInit) => Promise<Response>
  onProgress: (value: UpdateProgress) => void
  signal?: AbortSignal
}): Promise<{ filePath: string; size: number }> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const fileName = `Jiying-Update-${update.latestBuildId}-${update.platform}${updateFileExtension(update.platform)}`
  const destination = path.join(directory, fileName)
  const temporary = path.join(directory, `${fileName}.${randomUUID()}.part`)
  try {
    const response = await fetcher(update.downloadUrl, {
      method: "GET",
      headers: { Accept: "application/octet-stream" },
      redirect: "error",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)])
        : AbortSignal.timeout(30 * 60_000),
    })
    if (response.status !== 200 || response.redirected || !response.body) {
      throw new Error("更新安装包下载失败")
    }
    const lengthHeader = response.headers.get("content-length")
    const total = lengthHeader === null ? null : Number(lengthHeader)
    if (
      total !== null &&
      (!Number.isSafeInteger(total) || total <= 0 || total > MAX_UPDATE_BYTES)
    ) {
      throw new Error("更新安装包大小不正确")
    }
    onProgress({ received: 0, total, percent: total === null ? null : 0 })
    const file = await open(temporary, "wx", 0o600)
    const reader = response.body.getReader()
    let received = 0
    let lastPercent = -1
    let lastReportedBytes = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value.length) continue
        received += value.length
        if (received > MAX_UPDATE_BYTES || (total !== null && received > total)) {
          throw new Error("更新安装包超过预期大小")
        }
        let offset = 0
        while (offset < value.length) {
          const { bytesWritten } = await file.write(value, offset, value.length - offset)
          if (!bytesWritten) throw new Error("写入更新安装包失败")
          offset += bytesWritten
        }
        const percent = total === null ? null : Math.floor((received / total) * 100)
        if (
          (percent !== null && percent !== lastPercent) ||
          received - lastReportedBytes >= 256 * 1024
        ) {
          lastPercent = percent ?? -1
          lastReportedBytes = received
          onProgress({ received, total, percent })
        }
      }
      await file.sync()
    } finally {
      await reader.cancel().catch(() => undefined)
      await file.close()
    }
    if (received === 0 || (total !== null && received !== total)) {
      throw new Error("更新安装包下载不完整")
    }
    if (!(await validateUpdateFile(temporary, update.platform, received))) {
      throw new Error("更新安装包格式不正确")
    }
    await rm(destination, { force: true })
    await rename(temporary, destination)
    if (update.platform === "linux-amd" || update.platform === "linux-arm") {
      await chmod(destination, 0o700)
    }
    onProgress({ received, total: total ?? received, percent: 100 })
    return { filePath: destination, size: received }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
