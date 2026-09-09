import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)

const MODULE_ROOT = new URL(
  "../modules/jpush-registration/",
  import.meta.url
)

test("Android JPush module has an official AppKey default and remains privacy-gated", async () => {
  const [gradle, moduleSource, receiverSource, serviceSource, manifest] =
    await Promise.all([
      readFile(new URL("android/build.gradle", MODULE_ROOT), "utf8"),
      readFile(
        new URL(
          "android/src/main/java/cloud/baizhi/jpush/JPushRegistrationModule.kt",
          MODULE_ROOT
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "android/src/main/java/cloud/baizhi/jpush/JPushNotificationReceiver.kt",
          MODULE_ROOT
        ),
        "utf8"
      ),
      readFile(
        new URL(
          "android/src/main/java/cloud/baizhi/jpush/MagicChatJCommonService.kt",
          MODULE_ROOT
        ),
        "utf8"
      ),
      readFile(
        new URL("android/src/main/AndroidManifest.xml", MODULE_ROOT),
        "utf8"
      ),
    ])

  assert.match(gradle, /jpushVersion = '6\.2\.0'/)
  assert.match(gradle, /defaultJPushAppKey = '[a-f0-9]{24}'/)
  assert.match(
    gradle,
    /environmentValue\('JPUSH_APP_KEY'\) \?: defaultJPushAppKey/
  )
  for (const vendor of ["huawei", "xiaomi", "oppo", "vivo"]) {
    assert.match(
      gradle,
      new RegExp(`cn\\.jiguang\\.sdk\\.plugin:${vendor}:\\$\\{jpushVersion\\}`)
    )
  }
  assert.match(gradle, /requireCompleteChannel/)
  assert.doesNotMatch(gradle, /MASTER_SECRET/)
  const privacyGate = moduleSource.indexOf("!privacyAccepted")
  const initialize = moduleSource.indexOf("JPushInterface.init(context)")
  assert.ok(privacyGate >= 0 && privacyGate < initialize)
  assert.match(moduleSource, /JCollectionAuth\.enableAppTerminate\(context, false\)/)
  assert.match(moduleSource, /JCollectionAuth\.enableAutoWakeup\(context, false\)/)
  assert.match(moduleSource, /JPushInterface\.setGeofenceEnable\(context, false\)/)
  assert.match(moduleSource, /JPushInterface\.setLinkMergeEnable\(context, false\)/)
  assert.match(moduleSource, /JPushInterface\.stopPush\(context\)/)
  assert.match(moduleSource, /JPushInterface\.resumePush\(context\)/)
  assert.match(receiverSource, /collapse_key/)
  assert.match(receiverSource, /clearNotificationById/)
  assert.match(serviceSource, /class MagicChatJCommonService : JCommonService\(\)/)
  assert.match(manifest, /MagicChatJCommonService/)
  assert.match(manifest, /cn\.jiguang\.user\.service\.action/)
  assert.match(manifest, /JPushNotificationReceiver/)
  for (const permission of [
    "ACCESS_BACKGROUND_LOCATION",
    "ACCESS_FINE_LOCATION",
    "QUERY_ALL_PACKAGES",
    "READ_PHONE_STATE",
  ]) {
    assert.match(
      manifest,
      new RegExp(`${permission}[^>]+tools:node="remove"`)
    )
  }
})

test("Huawei channel config plugin changes generated Gradle idempotently", () => {
  const plugin = require("../plugins/with-jpush-vendor-channels.js") as {
    addHuaweiAppPlugin: (contents: string) => string
    addHuaweiProjectConfiguration: (contents: string) => string
    addHuaweiVersionCatalog: (contents: string) => string
    addVendorManifestPlaceholders: (contents: string) => string
  }
  const project = `buildscript {
  repositories { google() }
  dependencies { classpath('com.android.tools.build:gradle') }
}
allprojects { repositories { mavenCentral() } }
`
  const configuredProject = plugin.addHuaweiProjectConfiguration(project)
  assert.match(configuredProject, /developer\.huawei\.com\/repo/)
  assert.match(configuredProject, /com\.huawei\.agconnect:agcp:1\.9\.6\.300/)
  assert.equal(
    plugin.addHuaweiProjectConfiguration(configuredProject),
    configuredProject
  )

  const settings = "expoAutolinking.useExpoVersionCatalog()\ninclude ':app'\n"
  const configuredSettings = plugin.addHuaweiVersionCatalog(settings)
  assert.match(configuredSettings, /create\("libs"\)/)
  assert.match(configuredSettings, /version\("agp", "8\.12\.0"\)/)
  assert.match(configuredSettings, /plugin\("android-application"/)
  assert.equal(
    plugin.addHuaweiVersionCatalog(configuredSettings),
    configuredSettings
  )

  const app = 'apply plugin: "com.android.application"\napply plugin: "org.jetbrains.kotlin.android"\n'
  const configuredApp = plugin.addHuaweiAppPlugin(app)
  assert.match(configuredApp, /apply plugin: "com\.huawei\.agconnect"/)
  assert.equal(plugin.addHuaweiAppPlugin(configuredApp), configuredApp)

  const appWithDefaults = `${app}android { defaultConfig { applicationId "cloud.baizhi.chat" } }`
  const configuredDefaults = plugin.addVendorManifestPlaceholders(appWithDefaults)
  for (const variable of [
    "JPUSH_XIAOMI_APP_ID",
    "JPUSH_XIAOMI_APP_KEY",
    "JPUSH_VIVO_APP_ID",
    "JPUSH_VIVO_APP_KEY",
    "JPUSH_OPPO_APP_ID",
    "JPUSH_OPPO_APP_KEY",
    "JPUSH_OPPO_APP_SECRET",
  ]) {
    assert.match(configuredDefaults, new RegExp(variable))
  }
  assert.equal(
    plugin.addVendorManifestPlaceholders(configuredDefaults),
    configuredDefaults
  )
})

test("Android remote push never consumes an Expo or FCM token", async () => {
  const [lifecycle, provider] = await Promise.all([
    readFile(
      new URL("../src/notifications/push-lifecycle.ts", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../src/providers/push-provider.tsx", import.meta.url),
      "utf8"
    ),
  ])
  assert.match(lifecycle, /readJPushRegistrationID\(true\)/)
  assert.doesNotMatch(provider, /token\.type === "android"/)
})
