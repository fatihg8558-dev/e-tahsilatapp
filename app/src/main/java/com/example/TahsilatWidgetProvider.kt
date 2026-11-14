package com.example

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Build
import android.widget.RemoteViews

class TahsilatWidgetProvider : AppWidgetProvider() {
  companion object {
    private const val ACTION_OPEN_DASHBOARD = "com.example.WIDGET_OPEN_DASHBOARD"
    private const val ACTION_OPEN_TAHSILAT = "com.example.WIDGET_OPEN_TAHSILAT"
    private const val ACTION_OPEN_TEDIYE = "com.example.WIDGET_OPEN_TEDIYE"

    private fun buildTabPendingIntent(
      context: Context,
      requestCode: Int,
      action: String,
      tab: String
    ): PendingIntent {
      val intent = Intent(context, MainActivity::class.java).apply {
        this.action = action
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_CLEAR_TOP or
          Intent.FLAG_ACTIVITY_SINGLE_TOP
        putExtra("open_tab", tab)
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      return PendingIntent.getActivity(context, requestCode, intent, flags)
    }

    fun updateAppWidget(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetId: Int
    ) {
      val views = RemoteViews(context.packageName, R.layout.widget_tahsilat_quick)

      views.setOnClickPendingIntent(
        R.id.widget_header_container,
        buildTabPendingIntent(context, 100, ACTION_OPEN_DASHBOARD, "dashboard")
      )
      views.setOnClickPendingIntent(
        R.id.widget_btn_tahsilat,
        buildTabPendingIntent(context, 101, ACTION_OPEN_TAHSILAT, "tahsilat")
      )
      views.setOnClickPendingIntent(
        R.id.widget_btn_tediye,
        buildTabPendingIntent(context, 102, ACTION_OPEN_TEDIYE, "tediye")
      )

      appWidgetManager.updateAppWidget(appWidgetId, views)
    }
  }

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    for (appWidgetId in appWidgetIds) {
      updateAppWidget(context, appWidgetManager, appWidgetId)
    }
  }
}
