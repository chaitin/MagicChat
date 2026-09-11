import { readFile, writeFile } from "node:fs/promises"

export function parseDesktopTag(tag) {
  const match = /^desktop-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag)
  if (!match) {
    throw new Error("Stable Tag 必须严格匹配 desktop-v<major>.<minor>.<patch>")
  }
  return match.slice(1).join(".")
}

export async function writePackageMetadata(packagePath, { build, version }) {
  assertStableVersion(version)
  if (!Number.isSafeInteger(build) || build <= 0) {
    throw new Error("Desktop build 必须是正整数")
  }
  const original = JSON.parse(await readFile(packagePath, "utf8"))
  await writeFile(
    packagePath,
    `${JSON.stringify({ ...original, desktopBuild: build, version }, null, 2)}\n`,
  )
}

function assertStableVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Stable 版本无效：${version}`)
  }
}
