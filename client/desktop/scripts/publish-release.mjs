import path from "node:path"
import { createGhReleaseAdapter } from "./github-release-adapter.mjs"
import { publishReleaseTransaction } from "./release-transaction.mjs"

for (const name of ["plan", "repository", "run-id", "run-attempt"]) {
  if (!argument(name)) throw new Error(`缺少参数 --${name}`)
}
const result = await publishReleaseTransaction({
  adapter: createGhReleaseAdapter(),
  planPath: path.resolve(argument("plan")),
  repository: argument("repository"),
  runAttempt: argument("run-attempt"),
  runId: argument("run-id"),
})
console.log(JSON.stringify(result))

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
