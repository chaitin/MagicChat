import { appendFile } from "node:fs/promises"
import path from "node:path"
import { fetchPublishedDesktopBuild } from "./release-build.mjs"
import { prepareReleaseWorktree } from "./release-worktree.mjs"
assertArguments(["tag", "commit", "github-output"])
const repository = path.resolve(import.meta.dirname, "../..")
const tag = argument("tag")
if (!tag)
  throw new Error("用法：node scripts/prepare-release-worktree.mjs --tag <tag> [--commit <commit>]")

const result = await prepareReleaseWorktree({
  expectedCommit: argument("commit"),
  readPublishedDesktopBuild: fetchPublishedDesktopBuild,
  repository,
  tag,
})
const githubOutput = argument("github-output")
if (githubOutput) {
  await appendFile(
    githubOutput,
    `desktop-directory=${result.desktopDirectory}\nworktree=${result.worktree}\ntag=${result.tag}\ncommit=${result.commit}\nversion=${result.version}\nbuild=${result.build}\n`,
  )
}
console.log(JSON.stringify(result))

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function assertArguments(allowed) {
  const options = process.argv.slice(2).filter((value) => value.startsWith("--"))
  const unknown = options.find((value) => !allowed.includes(value.slice(2)))
  if (unknown) throw new Error(`不支持的参数：${unknown}`)
}
