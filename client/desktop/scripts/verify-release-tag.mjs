import path from "node:path"
import { inspectReleaseTag } from "./release-tag.mjs"

const result = await inspectReleaseTag({
  tag: argument("tag"),
  expectedCommit: argument("commit"),
  repository: path.resolve(import.meta.dirname, "../../.."),
})
console.log(JSON.stringify({ tag: result.tag, commit: result.commit }))

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
