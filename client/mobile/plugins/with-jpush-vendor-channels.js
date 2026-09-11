const fs = require("node:fs")
const path = require("node:path")
const {
  withAppBuildGradle,
  withDangerousMod,
  withProjectBuildGradle,
  withSettingsGradle,
} = require("expo/config-plugins")

const HUAWEI_REPOSITORY =
  "maven { url 'https://developer.huawei.com/repo/' }"
const HUAWEI_CLASSPATH = "classpath 'com.huawei.agconnect:agcp:1.9.6.300'"
const HUAWEI_PLUGIN = 'apply plugin: "com.huawei.agconnect"'
const HUAWEI_VERSION_CATALOG_MARKER = "// magicchat-huawei-agp-catalog"
const HUAWEI_VERSION_CATALOG = `${HUAWEI_VERSION_CATALOG_MARKER}
dependencyResolutionManagement {
  versionCatalogs {
    create("libs") {
      version("agp", "8.12.0")
      plugin("android-application", "com.android.application").versionRef("agp")
    }
  }
}`
const VENDOR_PLACEHOLDERS_MARKER = "// magicchat-jpush-vendor-placeholders"
const VENDOR_PLACEHOLDERS = `${VENDOR_PLACEHOLDERS_MARKER}
        def jpushVendorEnvironment = { String name -> System.getenv(name)?.trim() ?: '' }
        manifestPlaceholders += [
            XIAOMI_APPID: jpushVendorEnvironment('JPUSH_XIAOMI_APP_ID'),
            XIAOMI_APPKEY: jpushVendorEnvironment('JPUSH_XIAOMI_APP_KEY'),
            VIVO_APPID: jpushVendorEnvironment('JPUSH_VIVO_APP_ID'),
            VIVO_APPKEY: jpushVendorEnvironment('JPUSH_VIVO_APP_KEY'),
            OPPO_APPID: jpushVendorEnvironment('JPUSH_OPPO_APP_ID'),
            OPPO_APPKEY: jpushVendorEnvironment('JPUSH_OPPO_APP_KEY'),
            OPPO_APPSECRET: jpushVendorEnvironment('JPUSH_OPPO_APP_SECRET'),
        ]`

function configuredHuaweiFile(projectRoot) {
  const configured = process.env.JPUSH_HUAWEI_AGCONNECT_SERVICES?.trim()
  if (!configured) return null
  const source = path.resolve(projectRoot, configured)
  const stat = fs.statSync(source, { throwIfNoEntry: false })
  if (!stat?.isFile()) {
    throw new Error(
      "JPUSH_HUAWEI_AGCONNECT_SERVICES must point to an agconnect-services.json file"
    )
  }
  const parsed = JSON.parse(fs.readFileSync(source, "utf8"))
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Huawei agconnect-services.json must contain a JSON object")
  }
  return source
}

function addHuaweiProjectConfiguration(contents) {
  let next = contents
  if (!next.includes(HUAWEI_REPOSITORY)) {
    next = next.replace(
      /repositories\s*\{/g,
      (match) => `${match}\n    ${HUAWEI_REPOSITORY}`
    )
  }
  if (!next.includes(HUAWEI_CLASSPATH)) {
    next = next.replace(
      /(buildscript\s*\{[\s\S]*?dependencies\s*\{)/,
      `$1\n    ${HUAWEI_CLASSPATH}`
    )
  }
  return next
}

function addHuaweiVersionCatalog(contents) {
  if (contents.includes(HUAWEI_VERSION_CATALOG_MARKER)) return contents
  const insertionPoint = contents.indexOf("include ':app'")
  if (insertionPoint < 0) {
    throw new Error("Unable to add the Huawei AGP version catalog")
  }
  return `${contents.slice(0, insertionPoint)}${HUAWEI_VERSION_CATALOG}\n\n${contents.slice(insertionPoint)}`
}

function addHuaweiAppPlugin(contents) {
  if (contents.includes(HUAWEI_PLUGIN)) return contents
  return contents.replace(
    /apply plugin: ["']com\.android\.application["']\s*/,
    (match) => `${match}\n${HUAWEI_PLUGIN}\n`
  )
}

function addVendorManifestPlaceholders(contents) {
  if (contents.includes(VENDOR_PLACEHOLDERS_MARKER)) return contents
  return contents.replace(
    /(defaultConfig\s*\{)/,
    `$1\n        ${VENDOR_PLACEHOLDERS}`
  )
}

function withJPushVendorChannels(config) {
  const huaweiFile = configuredHuaweiFile(
    config._internal?.projectRoot || process.cwd()
  )

  config = withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== "groovy") {
      throw new Error("JPush vendor channels currently require Groovy Gradle files")
    }
    let contents = addVendorManifestPlaceholders(
      gradleConfig.modResults.contents
    )
    if (huaweiFile) contents = addHuaweiAppPlugin(contents)
    gradleConfig.modResults.contents = contents
    return gradleConfig
  })

  if (!huaweiFile) return config

  config = withSettingsGradle(config, (settingsConfig) => {
    settingsConfig.modResults.contents = addHuaweiVersionCatalog(
      settingsConfig.modResults.contents
    )
    return settingsConfig
  })

  config = withProjectBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== "groovy") {
      throw new Error("JPush Huawei channel currently requires Groovy Gradle files")
    }
    gradleConfig.modResults.contents = addHuaweiProjectConfiguration(
      gradleConfig.modResults.contents
    )
    return gradleConfig
  })

  return withDangerousMod(config, [
    "android",
    async (androidConfig) => {
      const destination = path.join(
        androidConfig.modRequest.platformProjectRoot,
        "app",
        "agconnect-services.json"
      )
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      if (path.resolve(huaweiFile) !== path.resolve(destination)) {
        fs.copyFileSync(huaweiFile, destination)
      }
      return androidConfig
    },
  ])
}

module.exports = withJPushVendorChannels
module.exports.addHuaweiAppPlugin = addHuaweiAppPlugin
module.exports.addHuaweiProjectConfiguration = addHuaweiProjectConfiguration
module.exports.addHuaweiVersionCatalog = addHuaweiVersionCatalog
module.exports.addVendorManifestPlaceholders = addVendorManifestPlaceholders
