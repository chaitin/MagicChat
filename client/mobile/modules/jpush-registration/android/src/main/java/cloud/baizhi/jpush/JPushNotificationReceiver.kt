package cloud.baizhi.jpush

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import cn.jpush.android.api.JPushInterface
import cn.jpush.android.api.NotificationMessage
import cn.jpush.android.service.JPushMessageReceiver
import org.json.JSONObject

class JPushNotificationReceiver : JPushMessageReceiver() {
  override fun isNeedShowNotification(
    context: Context,
    message: NotificationMessage,
    notificationChannel: String
  ): Boolean {
    val process = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(process)
    return process.importance > ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  override fun onNotifyMessageArrived(
    context: Context,
    message: NotificationMessage
  ) {
    val collapseKey = try {
      JSONObject(message.notificationExtras.orEmpty()).optString("collapse_key").trim()
    } catch (_: Throwable) {
      ""
    }
    if (collapseKey.isEmpty() || message.notificationId <= 0) return
    val preferences = context.applicationContext.getSharedPreferences(
      "magicchat.jpush.collapsed-notifications",
      Context.MODE_PRIVATE
    )
    val previousNotificationId = preferences.getInt(collapseKey, 0)
    if (previousNotificationId > 0 && previousNotificationId != message.notificationId) {
      JPushInterface.clearNotificationById(context.applicationContext, previousNotificationId)
    }
    preferences.edit().putInt(collapseKey, message.notificationId).apply()
  }

  override fun onNotifyMessageOpened(
    context: Context,
    message: NotificationMessage
  ) {
    JPushNotificationResponses.record(
      context.applicationContext,
      message.msgId,
      message.notificationExtras
    )
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      context.startActivity(it)
    }
  }
}
