const { withSettingsGradle } = require("expo/config-plugins")

const MARKER = "// jiying-pnpm-autolinking-cache"
const ORIGINAL = "ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)"

function addPnpmAutolinkingInputs(contents) {
  if (contents.includes(MARKER)) return contents
  if (!contents.includes(ORIGINAL)) {
    throw new Error("无法配置pnpm自动链接缓存：找不到Expo自动链接调用")
  }
  return contents.replace(ORIGINAL, `${MARKER}
    ex.autolinkLibrariesFromCommand(
      expoAutolinking.rnConfigCommand,
      rootDir.parentFile,
      layout.rootDirectory.dir("../").files(
        "yarn.lock", "package-lock.json", "package.json", "react-native.config.js",
        "pnpm-lock.yaml", "pnpm-workspace.yaml"
      )
    )`)
}

module.exports = function withPnpmAutolinkingCache(config) {
  return withSettingsGradle(config, (androidConfig) => {
    androidConfig.modResults.contents = addPnpmAutolinkingInputs(androidConfig.modResults.contents)
    return androidConfig
  })
}
module.exports.addPnpmAutolinkingInputs = addPnpmAutolinkingInputs
