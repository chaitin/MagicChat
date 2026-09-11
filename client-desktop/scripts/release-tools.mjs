import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { parseDesktopTag } from "./release-version.mjs"

export { parseDesktopTag }

export async function fileSha512(filePath) {
  return fileDigest(filePath, "sha512", "base64")
}

export async function fileSha256(filePath) {
  return fileDigest(filePath, "sha256", "hex")
}

export async function fileDigests(filePath) {
  const sha256 = createHash("sha256")
  const sha512 = createHash("sha512")
  for await (const chunk of createReadStream(filePath)) {
    sha256.update(chunk)
    sha512.update(chunk)
  }
  return {
    sha256: sha256.digest("hex"),
    sha512: sha512.digest("base64"),
  }
}

export async function mapWithConcurrency(values, concurrency, mapper) {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error("并发数必须为正整数")
  }
  const inputs = [...values]
  const results = new Array(inputs.length)
  let failure
  let failed = false
  let nextIndex = 0
  const worker = async () => {
    while (!failed) {
      const index = nextIndex
      nextIndex += 1
      if (index >= inputs.length) return
      try {
        results[index] = await mapper(inputs[index], index)
      } catch (error) {
        failure = error
        failed = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()))
  if (failed) throw failure
  return results
}

async function fileDigest(filePath, algorithm, encoding) {
  const digest = createHash(algorithm)
  for await (const chunk of createReadStream(filePath)) digest.update(chunk)
  return digest.digest(encoding)
}

export function linuxArtifactSuffixes(arch) {
  if (arch === "x64") {
    return {
      appImage: "linux-x86_64.AppImage",
      deb: "linux-amd64.deb",
    }
  }
  if (arch === "arm64") {
    return {
      appImage: "linux-arm64.AppImage",
      deb: "linux-arm64.deb",
    }
  }
  throw new Error(`不支持的 Linux 制品架构：${arch}`)
}
