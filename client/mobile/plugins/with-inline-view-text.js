const { withMainApplication } = require("expo/config-plugins")

const REGISTRATION = "add(0, cloud.baizhi.fontfallback.InlineViewTextPackage())"

function addInlineViewTextPackage(contents) {
  if (contents.includes(REGISTRATION)) return contents
  const packages = /PackageList\(this\)\.packages\.apply\s*\{/
  if (!packages.test(contents)) throw new Error("无法修正行内视图：找不到 MainApplication 的 ReactPackage 列表")
  return contents.replace(packages, (match) => `${match}\n          ${REGISTRATION}`)
}

module.exports = function withInlineViewText(config) {
  return withMainApplication(config, (androidConfig) => {
    if (androidConfig.modResults.language !== "kt") throw new Error("行内视图尺寸修正需要 Kotlin MainApplication")
    androidConfig.modResults.contents = addInlineViewTextPackage(androidConfig.modResults.contents)
    return androidConfig
  })
}
module.exports.addInlineViewTextPackage = addInlineViewTextPackage
