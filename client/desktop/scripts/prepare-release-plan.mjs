import path from "node:path"
import { prepareReleasePlan } from "./release-plan.mjs"

const repositoryRoot = path.resolve(import.meta.dirname, "../../..")
const result = await prepareReleasePlan({
  repositoryRoot,
  tag: argument("tag"),
  commit: argument("commit"),
  repository: argument("repository"),
  inputDirectory: path.resolve(argument("input")),
  outputDirectory: path.resolve(argument("output")),
})
console.log(JSON.stringify(result))

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value) throw new Error(`缺少 --${name}`)
  return value
}
