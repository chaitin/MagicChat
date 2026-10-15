import assert from "node:assert/strict"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const expo = require.resolve("expo/package.json")
const load = (name: string) => require(require.resolve(name, { paths: [expo] }))

test("Expo production export keeps shared sources and external font directories indexed", async () => {
  const { getConfig } = load("@expo/config")
  const { loadMetroConfigAsync } = load("@expo/cli/build/src/start/server/metro/instantiateMetro.js")
  const { config } = await loadMetroConfigAsync(projectRoot, {}, {
    exp: getConfig(projectRoot).exp,
    isExporting: true,
    getMetroBundler: () => undefined,
  })
  assert.equal(config.resolver.unstable_onDemandFilesystem, false)
  for (const directory of ["../shared", "../../assets/fonts/misans", "../../assets/fonts/noto-color-emoji"]) {
    assert.ok(config.watchFolders.includes(path.resolve(projectRoot, directory)), `Missing export directory: ${directory}`)
  }
})
