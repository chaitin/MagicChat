import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { load } from "js-yaml"
import {
  verifyLinuxPackage,
  verifyMacPackage,
  verifyWindowsPackage,
} from "./native-package-tools.mjs"
import { linuxArtifactSuffixes, parseDesktopTag } from "./release-tools.mjs"

const root = path.resolve(import.meta.dirname, "..")
const platform = argument("platform")
const arch = argument("arch")
const tag = argument("tag")
const requestedBuild = argument("build")
if (
  !["win", "mac", "linux"].includes(platform) ||
  !["x64", "arm64", "universal"].includes(arch) ||
  (arch === "universal") !== (platform === "mac")
) {
  throw new Error(
    "用法：pnpm verify:package -- --platform <win|mac|linux> --arch <x64|arm64|universal> [--tag desktop-v<semver>] [--build <非负整数>]",
  )
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
const expectedVersion = tag ? parseDesktopTag(tag) : packageJson.version
const expectedBuild =
  requestedBuild === undefined ? packageJson.desktopBuild : Number(requestedBuild)
assert(packageJson.version === expectedVersion, "package.json 版本与 Tag 不一致")
assert(Number.isSafeInteger(expectedBuild) && expectedBuild >= 0, "Desktop build 无效")
assert(packageJson.desktopBuild === expectedBuild, "package.json build 与发布 build 不一致")
const builder = load(await readFile(path.join(root, "electron-builder.yml"), "utf8"))
assert(builder.appId === "com.magicchat.desktop", "应用 ID 配置无效")
assert(builder.productName === "即应", "应用展示名称配置无效")
assert(builder.publish == null, "electron-builder 不得生成旧版更新清单")

const dist = path.join(root, "dist")
const names = await readdir(dist)
let nativeResult
if (platform === "win") {
  nativeResult = await verifyWindowsPackage({
    arch,
    applicationDirectory: path.join(dist, arch === "x64" ? "win-unpacked" : "win-arm64-unpacked"),
    artifact: artifact(`win-${arch}.exe`),
    expectedBuild,
    expectedVersion,
  })
} else if (platform === "mac") {
  nativeResult = await verifyMacPackage({
    dmg: artifact("mac-universal.dmg"),
    expectedBuild,
    expectedVersion,
    expectedTeamId: "8RK3WCWST9",
  })
} else {
  const suffixes = linuxArtifactSuffixes(arch)
  nativeResult = await verifyLinuxPackage({
    appImage: artifact(suffixes.appImage),
    arch,
    deb: artifact(suffixes.deb),
    expectedBuild,
    expectedVersion,
  })
}

console.log(JSON.stringify({ appId: builder.appId, ...nativeResult }))

function artifact(suffix) {
  const expected = `Jiying-${expectedVersion}-${suffix}`
  if (!names.includes(expected)) throw new Error(`缺少发布制品：${expected}`)
  return path.join(dist, expected)
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
