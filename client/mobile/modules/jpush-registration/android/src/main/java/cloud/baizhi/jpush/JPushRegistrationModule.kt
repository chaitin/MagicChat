package cloud.baizhi.jpush

import android.os.Bundle
import cn.jiguang.api.utils.JCollectionAuth
import cn.jpush.android.api.JPushInterface
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean

class JPushRegistrationModule : Module(), JPushNotificationResponseListener {
  private val initialized = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("MagicChatJPushRegistration")

    Events("onNotificationResponse")

    OnCreate {
      JPushNotificationResponses.addListener(this@JPushRegistrationModule)
    }

    OnDestroy {
      JPushNotificationResponses.removeListener(this@JPushRegistrationModule)
    }

    AsyncFunction("isConfiguredAsync") {
      BuildConfig.JPUSH_CONFIGURED
    }

    AsyncFunction("initializeAsync") { privacyAccepted: Boolean ->
      if (!BuildConfig.JPUSH_CONFIGURED || !privacyAccepted) {
        return@AsyncFunction false
      }
      val context = appContext.reactContext?.applicationContext
        ?: return@AsyncFunction false
      if (initialized.compareAndSet(false, true)) {
        try {
          JCollectionAuth.enableAppTerminate(context, false)
          JCollectionAuth.enableAutoWakeup(context, false)
          JPushInterface.setGeofenceEnable(context, false)
          JPushInterface.setLinkMergeEnable(context, false)
          JPushInterface.setDebugMode(BuildConfig.DEBUG)
          JPushInterface.init(context)
          if (JPushInterface.isPushStopped(context)) {
            JPushInterface.resumePush(context)
          }
        } catch (error: Throwable) {
          initialized.set(false)
          throw error
        }
      }
      true
    }

    AsyncFunction("stopAsync") {
      val context = appContext.reactContext?.applicationContext
        ?: return@AsyncFunction null
      if (initialized.compareAndSet(true, false)) {
        JPushInterface.stopPush(context)
      }
      null
    }

    AsyncFunction("getRegistrationIdAsync") {
      if (!initialized.get()) {
        return@AsyncFunction ""
      }
      val context = appContext.reactContext?.applicationContext
        ?: return@AsyncFunction ""
      JPushInterface.getRegistrationID(context)?.trim().orEmpty()
    }

    AsyncFunction("getLastNotificationResponseAsync") {
      val context = appContext.reactContext?.applicationContext
        ?: return@AsyncFunction null
      JPushNotificationResponses.load(context)
    }

    AsyncFunction("clearLastNotificationResponseAsync") {
      val context = appContext.reactContext?.applicationContext
        ?: return@AsyncFunction null
      JPushNotificationResponses.clear(context)
      null
    }
  }

  override fun onNotificationResponse(response: Bundle) {
    sendEvent("onNotificationResponse", response)
  }
}
