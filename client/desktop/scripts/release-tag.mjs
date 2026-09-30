import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execute = promisify(execFile)
const tagPattern = /^desktop\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export async function inspectReleaseTag({ tag, expectedCommit, repository }) {
  if (!tagPattern.test(tag)) throw new Error("Desktop Tag 必须是 desktop/<标识>")
  const objectType = await git(repository, ["cat-file", "-t", `refs/tags/${tag}`])
  if (objectType !== "tag" && objectType !== "commit") throw new Error("Desktop Tag 无效")
  const commit = await git(repository, ["rev-parse", `${tag}^{commit}`])
  if (
    expectedCommit &&
    commit !== (await git(repository, ["rev-parse", `${expectedCommit}^{commit}`]))
  ) {
    throw new Error("Tag Commit 与 checkout 不一致")
  }
  const rawNotes =
    objectType === "tag"
      ? await git(repository, ["for-each-ref", "--format=%(contents)", `refs/tags/${tag}`])
      : await git(repository, ["log", "-1", "--format=%s", commit])
  const notes = rawNotes
    .replace(/\r\n?/g, "\n")
    .replace(/\n-----BEGIN (?:PGP|SSH) SIGNATURE-----[\s\S]*$/, "")
    .trim()
  if (!notes || notes.length > 32 * 1024 || /[^\P{Cc}\n\t]/u.test(notes)) {
    throw new Error("Desktop Tag 发布说明无效")
  }
  return { tag, commit, notes }
}

async function git(repository, args) {
  const { stdout } = await execute("git", args, {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 128 * 1024,
  })
  return stdout.trim()
}
