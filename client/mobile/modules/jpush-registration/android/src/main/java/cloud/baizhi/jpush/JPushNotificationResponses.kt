package cloud.baizhi.jpush

import android.content.Context
import android.os.Bundle
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet

fun interface JPushNotificationResponseListener {
  fun onNotificationResponse(response: Bundle)
}

object JPushNotificationResponses {
  private const val PREFERENCES = "magicchat_jpush_notification_response"
  private const val LAST_RESPONSE = "last_response"
  private val listeners = CopyOnWriteArraySet<JPushNotificationResponseListener>()

  @JvmStatic
  fun addListener(listener: JPushNotificationResponseListener) {
    listeners.add(listener)
  }

  @JvmStatic
  fun removeListener(listener: JPushNotificationResponseListener) {
    listeners.remove(listener)
  }

  @JvmStatic
  fun record(context: Context, identifier: String?, extras: String?) {
    val parsed = parse(identifier, extras) ?: return
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .edit()
      .putString(LAST_RESPONSE, JSONObject().apply {
        put("identifier", parsed.getString("identifier"))
        put("date", parsed.getDouble("date"))
        put("event", parsed.getString("event"))
        put("grantId", parsed.getString("grantId"))
        put("routeToken", parsed.getString("routeToken"))
      }.toString())
      .apply()
    val bundle = parsed.toBundle()
    listeners.forEach { listener -> listener.onNotificationResponse(bundle) }
  }

  @JvmStatic
  fun load(context: Context): Bundle? {
    val raw = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .getString(LAST_RESPONSE, null)
      ?: return null
    return runCatching { JSONObject(raw).toBundle() }.getOrNull()
  }

  @JvmStatic
  fun clear(context: Context) {
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .edit()
      .remove(LAST_RESPONSE)
      .apply()
  }

  private fun parse(identifier: String?, extras: String?): JSONObject? {
    if (extras.isNullOrBlank()) return null
    val source = runCatching { JSONObject(extras) }.getOrNull() ?: return null
    val event = source.optString("event").trim()
    val grantId = source.optString("grant_id").trim()
    val routeToken = source.optString("route_token").trim()
    if (event != "message.created" || grantId.isEmpty() || routeToken.length < 32) {
      return null
    }
    return JSONObject().apply {
      put("identifier", identifier?.trim().orEmpty())
      put("date", System.currentTimeMillis().toDouble())
      put("event", event)
      put("grantId", grantId)
      put("routeToken", routeToken)
    }
  }

  private fun JSONObject.toBundle() = Bundle().apply {
    putString("identifier", optString("identifier"))
    putDouble("date", optDouble("date"))
    putString("event", optString("event"))
    putString("grantId", optString("grantId"))
    putString("routeToken", optString("routeToken"))
  }
}
