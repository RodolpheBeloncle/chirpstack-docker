package com.gardenmobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

// JS : NativeModules.Notify.start(HA_URL, HA_TOKEN) → mémorise la config et lance NotifyService
class NotifyModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "Notify"

  @ReactMethod
  fun start(url: String, token: String) {
    ctx.getSharedPreferences(NotifyService.PREFS, Context.MODE_PRIVATE).edit()
        .putString("url", url).putString("token", token).apply()
    NotifyService.start(ctx)
  }
}

class NotifyPackage : ReactPackage {
  override fun createNativeModules(ctx: ReactApplicationContext) = listOf(NotifyModule(ctx))
  override fun createViewManagers(ctx: ReactApplicationContext) =
      emptyList<com.facebook.react.uimanager.ViewManager<*, *>>()
}

// Relance le service après redémarrage du téléphone
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED &&
        ctx.getSharedPreferences(NotifyService.PREFS, Context.MODE_PRIVATE).contains("token"))
        NotifyService.start(ctx)
  }
}
