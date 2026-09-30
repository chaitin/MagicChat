import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execute = promisify(execFile)

export function createGhReleaseAdapter({ token = process.env.GH_TOKEN } = {}) {
  if (!token) throw new Error("缺少 GH_TOKEN，无法执行 Draft 发布事务")
  const env = { ...process.env, GH_TOKEN: token }
  return {
    async createDraft({ body, commit, name, owner, repository, tag }) {
      return api(
        repository,
        [
          "--method",
          "POST",
          `repos/${repository}/releases`,
          "-f",
          `tag_name=${tag}`,
          "-f",
          `target_commitish=${commit}`,
          "-f",
          `name=${name}`,
          "-f",
          `body=${body}\n\n${ownerMarker(owner)}`,
          "-F",
          "draft=true",
          "-F",
          "prerelease=false",
          "-f",
          "make_latest=false",
        ],
        env,
      )
    },
    async deleteDraft({ id, repository }) {
      await api(repository, ["--method", "DELETE", `repos/${repository}/releases/${id}`], env)
    },
    async findByTag({ repository, tag }) {
      const pages = await api(
        repository,
        ["--paginate", "--slurp", `repos/${repository}/releases?per_page=100`],
        env,
      )
      const releases = pages.flat()
      return releases.filter((release) => release.tag_name === tag)
    },
    async resolveTagCommit({ repository, tag }) {
      let reference = await api(repository, [releaseTagRefPath(repository, tag)], env)
      if (reference.object?.type === "commit") return reference.object.sha
      if (reference.object?.type !== "tag") throw new Error("远端 Desktop Tag 无效")
      for (let depth = 0; depth < 4; depth += 1) {
        const annotated = await api(
          repository,
          [`repos/${repository}/git/tags/${reference.object.sha}`],
          env,
        )
        if (annotated.object?.type === "commit") return annotated.object.sha
        if (annotated.object?.type !== "tag") break
        reference = annotated
      }
      throw new Error("无法解引用远端 Stable Tag Commit")
    },
    async getAssets({ id, repository }) {
      return api(repository, [`repos/${repository}/releases/${id}/assets?per_page=100`], env)
    },
    async getRelease({ id, repository }) {
      return api(repository, [`repos/${repository}/releases/${id}`], env)
    },
    async publish({ id, repository }) {
      return api(
        repository,
        [
          "--method",
          "PATCH",
          `repos/${repository}/releases/${id}`,
          "-F",
          "draft=false",
          "-F",
          "prerelease=false",
          "-f",
          "make_latest=true",
        ],
        env,
      )
    },
    async uploadAsset({ filePath, id, name, repository }) {
      return api(repository, releaseAssetUploadArguments({ filePath, id, name, repository }), env)
    },
  }
}

export function releaseAssetUploadArguments({ filePath, id, name, repository }) {
  return [
    "--method",
    "POST",
    "-H",
    "Content-Type: application/octet-stream",
    "--input",
    filePath,
    `https://uploads.github.com/repos/${repository}/releases/${id}/assets?name=${encodeURIComponent(name)}`,
  ]
}

export function releaseTagRefPath(repository, tag) {
  return `repos/${repository}/git/ref/tags/${tag.split("/").map(encodeURIComponent).join("/")}`
}

export function ownerMarker(owner) {
  return `<!-- magicchat-release-owner:${owner} -->`
}

async function api(repository, arguments_, env) {
  const { stdout } = await execute("gh", ["api", ...arguments_], {
    encoding: "utf8",
    env,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (!stdout.trim()) return undefined
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`GitHub API 返回非 JSON 响应：${repository}`)
  }
}
