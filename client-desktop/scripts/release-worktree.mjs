import { execFile } from "node:child_process"
import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { resolveDesktopReleaseBuild } from "./release-build.mjs"
import { inspectReleaseTag } from "./release-tag.mjs"
import { writePackageMetadata } from "./release-version.mjs"

const execute = promisify(execFile)

export function releaseWorktreeRoot(environment = process.env) {
  return environment.RUNNER_TEMP || os.tmpdir()
}

export async function prepareReleaseWorktree({
  expectedCommit,
  readPublishedDesktopBuild,
  repository,
  tag,
}) {
  const release = await inspectReleaseTag({ expectedCommit, repository, tag })
  const sourcePackage = path.join(repository, "client-desktop/package.json")
  const sourceBefore = await readFile(sourcePackage, "utf8")
  const worktree = await mkdtemp(path.join(releaseWorktreeRoot(), "magicchat-desktop-release-"))
  await execute("git", ["worktree", "add", "--detach", worktree, release.commit], {
    cwd: repository,
  })
  const desktopDirectory = path.join(worktree, "client-desktop")
  const { build } = await resolveDesktopReleaseBuild({
    currentTag: tag,
    readPublishedDesktopBuild,
    repository,
  })
  await writePackageMetadata(path.join(desktopDirectory, "package.json"), {
    build,
    version: release.version,
  })
  if ((await readFile(sourcePackage, "utf8")) !== sourceBefore) {
    throw new Error("版本注入修改了原始工作树")
  }
  return { ...release, build, desktopDirectory, worktree }
}
