package com.example

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

class FridayBackupReceiver : BroadcastReceiver() {
  companion object {
    const val CHANNEL_ID = "weekly_backup_reminder"
    const val CHANNEL_NAME = "Haftalık Yedekleme Hatırlatıcısı"
    const val NOTIFICATION_ID = 5001

    fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
          ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
          val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_DEFAULT
          ).apply {
            description = "Her Cuma haftalık JSON yedekleme hatırlatıcısı gönderir."
          }
          manager.createNotificationChannel(channel)
        }
      }
    }
  }

  override fun onReceive(context: Context, intent: Intent?) {
    try {
      ensureChannel(context)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val granted = ContextCompat.checkSelfPermission(
          context,
          Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
          return
        }
      }

      val openIntent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        putExtra("open_tab", "yedekleme")
      }
      val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      } else {
        PendingIntent.FLAG_UPDATE_CURRENT
      }
      val contentIntent = PendingIntent.getActivity(
        context,
        NOTIFICATION_ID,
        openIntent,
        pendingIntentFlags
      )

      val title = "Cuma Yedekleme Hatırlatıcısı"
      val text = "Uygulama verilerinizi güvende tutmak için haftalık JSON yedeğinizi alabilirsiniz."

      val notification = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_popup_reminder)
        .setContentTitle(title)
        .setContentText(text)
        .setStyle(NotificationCompat.BigTextStyle().bigText(text))
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setAutoCancel(true)
        .setContentIntent(contentIntent)
        .build()

      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    } catch (e: Exception) {
      Log.e("FridayBackupReceiver", "Failed to display Friday backup reminder", e)
    }
  }
}
