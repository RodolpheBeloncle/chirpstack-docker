package com.gardenmobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

// Notifications sans Firebase : WebSocket HA permanent, abonné à `sensor.notification` (événement `iotrigger_notify`)
// (data: title, message), déclenché par les automatisations HA.
class NotifyService : Service() {
  private val client = OkHttpClient.Builder().pingInterval(30, TimeUnit.SECONDS).build()
  private val handler = Handler(Looper.getMainLooper())
  private var ws: WebSocket? = null
  private var stopped = false

  override fun onBind(intent: Intent?) = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    channels()
    val fg = Notification.Builder(this, CH_SERVICE)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle("IoTrigger")
        .setContentText("Surveillance active")
        .setContentIntent(openApp())
        .build()
    if (Build.VERSION.SDK_INT >= 34)
        startForeground(1, fg, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    else startForeground(1, fg)
    if (ws == null) connect()
    return START_STICKY
  }

  override fun onDestroy() {
    stopped = true
    ws?.close(1000, null)
    super.onDestroy()
  }

  private fun connect() {
    val p = getSharedPreferences(PREFS, MODE_PRIVATE)
    val url = p.getString("url", null) ?: return stopSelf()
    val token = p.getString("token", null) ?: return stopSelf()
    val req = Request.Builder().url(url.replaceFirst("http", "ws") + "/api/websocket").build()
    ws = client.newWebSocket(req, object : WebSocketListener() {
      override fun onMessage(webSocket: WebSocket, text: String) {
        val msg = JSONObject(text)
        when (msg.optString("type")) {
          "auth_required" -> webSocket.send(JSONObject().put("type", "auth").put("access_token", token).toString())
          // subscribe_entities sur sensor.notification : autorisé aussi aux comptes non-admin
          "auth_ok" -> webSocket.send(JSONObject().put("id", 1).put("type", "subscribe_entities")
              .put("entity_ids", JSONArray().put("sensor.notification")).toString())
          "event" -> {
            // "a" = état initial (ignoré), "c" = changement ; état = "horodatage|titre|message"
            val st = msg.getJSONObject("event").optJSONObject("c")?.optJSONObject("sensor.notification")
                ?.optJSONObject("+")?.optString("s") ?: return
            val d = st.split("|", limit = 3)
            if (d.size < 3) return
            show(d[1].ifBlank { "Notification" }, d[2])
          }
        }
      }
      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = retry()
      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = retry()
    })
  }

  // ponytail: reconnexion à pas fixe (30 s), backoff exponentiel si ça martèle le serveur
  private fun retry() {
    ws = null
    if (!stopped) handler.postDelayed({ if (ws == null) connect() }, 30_000)
  }

  private fun show(title: String, text: String) {
    val n = Notification.Builder(this, CH_ALERTS)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(title)
        .setContentText(text)
        .setStyle(Notification.BigTextStyle().bigText(text))
        .setAutoCancel(true)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .setCategory(Notification.CATEGORY_ALARM)
        .setContentIntent(openApp())
        .build()
    getSystemService(NotificationManager::class.java).notify(System.currentTimeMillis().toInt(), n)
  }

  private fun openApp() = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)

  private fun channels() {
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CH_SERVICE, "Service", NotificationManager.IMPORTANCE_MIN))
    // Réglages d'un canal figés à sa création → nouvel id pour activer vibration + écran verrouillé
    nm.deleteNotificationChannel("alerts")
    nm.createNotificationChannel(
        NotificationChannel(CH_ALERTS, "Alertes", NotificationManager.IMPORTANCE_HIGH).apply {
          enableVibration(true)
          vibrationPattern = longArrayOf(0, 400, 200, 400)
          lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        })
  }

  companion object {
    const val PREFS = "notify"
    private const val CH_SERVICE = "service"
    private const val CH_ALERTS = "alerts_v2"

    fun start(ctx: Context) = ctx.startForegroundService(Intent(ctx, NotifyService::class.java))
  }
}
