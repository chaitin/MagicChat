import { readFile } from "node:fs/promises"
import path from "node:path"
import { readOfficialVersionBase } from "./desktop-version-file.mjs"
import { parseReleaseInput, prepareReleaseAssets } from "./release-assets.mjs"
import { inspectReleaseTag } from "./release-tag.mjs"

const repository = path.resolve(import.meta.dirname, "../..")
const tag = argument("tag")
const build = Number(argument("build"))
const outputDirectory = path.resolve(argument("output") ?? "")
const versionBasePath = argument("version-base")
const rawInputs = repeatedArguments("input")
if (
  !tag ||
  !Number.isSafeInteger(build) ||
  build <= 0 ||
  !outputDirectory ||
  rawInputs.length === 0
) {
  throw new Error(
    "用法：node scripts/prepare-release-assets.mjs --tag <tag> --build <正整数> [--version-base <version.json>] --output <目录> --input <platform:arch:目录>（五次）",
  )
}
const release = await inspectReleaseTag({ expectedCommit: argument("commit"), repository, tag })
const inputs = rawInputs.map((value) => {
  const input = parseReleaseInput(value)
  return { ...input, directory: path.resolve(input.directory) }
})
const versionBase = versionBasePath
  ? JSON.parse(await readFile(path.resolve(versionBasePath), "utf8"))
  : await readOfficialVersionBase()
const plan = await prepareReleaseAssets({
  ...release,
  build,
  inputs,
  outputDirectory,
  versionBase,
})
console.log(JSON.stringify(plan))

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function repeatedArguments(name) {
  const values = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === `--${name}` && process.argv[index + 1])
      values.push(process.argv[index + 1])
  }
  return values
}
