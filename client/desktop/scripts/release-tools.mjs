import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"

export async function fileSha256(filePath) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

export async function fileDigests(filePath) {
  const sha256 = createHash("sha256")
  const sha512 = createHash("sha512")
  for await (const chunk of createReadStream(filePath)) {
    sha256.update(chunk)
    sha512.update(chunk)
  }
  return { sha256: sha256.digest("hex"), sha512: sha512.digest("base64") }
}

export async function mapWithConcurrency(values, concurrency, mapper) {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) throw new Error("并发数必须为正整数")
  const inputs = [...values]
  const results = new Array(inputs.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
      while (next < inputs.length) {
        const index = next++
        results[index] = await mapper(inputs[index], index)
      }
    }),
  )
  return results
}
