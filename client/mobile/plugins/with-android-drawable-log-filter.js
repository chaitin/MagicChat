const { withMainApplication } = require("expo/config-plugins")

const MARKER = "// jiying-known-drawable-log-filter"
const delegateSource = `${MARKER}
private class KnownDrawableLoggingDelegate : com.facebook.common.logging.LoggingDelegate by
  com.facebook.common.logging.FLogDefaultLoggingDelegate.getInstance() {
  override fun w(tag: String, message: String) {
    // Fresco cannot bitmap-round these drawables; RN clips them at the View layer.
    if (tag == "WrappingUtils" && (
      message.startsWith("Don't know how to round that drawable: com.facebook.react.views.image.ReactImageDownloadListener\\$EmptyDrawable@") ||
      message.startsWith("Don't know how to round that drawable: com.facebook.fresco.animation.drawable.AnimatedDrawable2@")
    )) return
    com.facebook.common.logging.FLogDefaultLoggingDelegate.getInstance().w(tag, message)
  }
}
`

function addDrawableLogFilter(contents) {
  if (contents.includes(MARKER)) return contents
  const onCreate = /(override fun onCreate\(\)\s*\{\s*super\.onCreate\(\))/
  if (!onCreate.test(contents)) {
    throw new Error("无法安装图片日志过滤器：找不到 MainApplication.onCreate")
  }
  return contents.replace(onCreate, `$1
    if (!BuildConfig.DEBUG) {
      com.facebook.common.logging.FLog.setLoggingDelegate(KnownDrawableLoggingDelegate())
    }`) + `\n${delegateSource}`
}

module.exports = function withAndroidDrawableLogFilter(config) {
  return withMainApplication(config, (androidConfig) => {
    if (androidConfig.modResults.language !== "kt") {
      throw new Error("图片日志过滤器需要 Kotlin MainApplication")
    }
    androidConfig.modResults.contents = addDrawableLogFilter(androidConfig.modResults.contents)
    return androidConfig
  })
}
module.exports.addDrawableLogFilter = addDrawableLogFilter
module.exports.delegateSource = delegateSource
