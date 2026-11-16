package de.taktwerk.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

public class TaktWerkWidgetProvider extends AppWidgetProvider {

    public static final String PREFS_NAME = "taktwerk_widget";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    public static void updateAllWidgets(Context context) {
        if (context == null) return;
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        ComponentName provider = new ComponentName(context, TaktWerkWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(provider);
        if (ids != null && ids.length > 0) {
            for (int id : ids) {
                updateAppWidget(context, manager, id);
            }
        }
    }

    public static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean isRunning = prefs.getBoolean("isRunning", false);
        boolean isPaused = prefs.getBoolean("isPaused", false);
        String timerTitle = prefs.getString("timerTitle", "");
        String customerName = prefs.getString("customerName", "");
        String todayHoursLabel = prefs.getString("todayHoursLabel", "0,0 Std.");
        String quickTasksJson = prefs.getString("quickTasksJson", "[]");

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.taktwerk_widget);
        views.setTextViewText(R.id.widget_hours_text, "Heute: " + todayHoursLabel);

        if (isRunning && !timerTitle.isEmpty()) {
            views.setTextViewText(
                R.id.widget_status_text,
                (isPaused ? "⏸ " : "▶ ") + timerTitle
            );
            views.setTextViewText(
                R.id.widget_sub_text,
                customerName.isEmpty() ? (isPaused ? "Timer pausiert" : "Zeiterfassung läuft") : customerName
            );
        } else {
            views.setTextViewText(R.id.widget_status_text, "Kein Timer aktiv");
            views.setTextViewText(R.id.widget_sub_text, "Tippen zum Starten oder für Übersicht");
        }

        Intent openIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("taktwerk://widget/open"), context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPending = PendingIntent.getActivity(
            context,
            200 + appWidgetId,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_root, openPending);
        views.setOnClickPendingIntent(R.id.widget_open_btn, openPending);

        views.setViewVisibility(R.id.widget_quick_1, View.GONE);
        views.setViewVisibility(R.id.widget_quick_2, View.GONE);

        try {
            JSONArray tasks = new JSONArray(quickTasksJson);
            if (tasks.length() >= 1) {
                JSONObject t1 = tasks.getJSONObject(0);
                String uid1 = t1.optString("tagUid", "");
                String title1 = t1.optString("title", "Start 1");
                if (!uid1.isEmpty()) {
                    views.setViewVisibility(R.id.widget_quick_1, View.VISIBLE);
                    views.setTextViewText(R.id.widget_quick_1, "▶ " + title1);
                    Intent i1 = new Intent(
                        Intent.ACTION_VIEW,
                        Uri.parse("taktwerk://widget/trigger?tagUid=" + Uri.encode(uid1)),
                        context,
                        MainActivity.class
                    );
                    i1.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    PendingIntent p1 = PendingIntent.getActivity(
                        context,
                        301 + appWidgetId,
                        i1,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    );
                    views.setOnClickPendingIntent(R.id.widget_quick_1, p1);
                }
            }
            if (tasks.length() >= 2) {
                JSONObject t2 = tasks.getJSONObject(1);
                String uid2 = t2.optString("tagUid", "");
                String title2 = t2.optString("title", "Start 2");
                if (!uid2.isEmpty()) {
                    views.setViewVisibility(R.id.widget_quick_2, View.VISIBLE);
                    views.setTextViewText(R.id.widget_quick_2, "▶ " + title2);
                    Intent i2 = new Intent(
                        Intent.ACTION_VIEW,
                        Uri.parse("taktwerk://widget/trigger?tagUid=" + Uri.encode(uid2)),
                        context,
                        MainActivity.class
                    );
                    i2.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    PendingIntent p2 = PendingIntent.getActivity(
                        context,
                        401 + appWidgetId,
                        i2,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    );
                    views.setOnClickPendingIntent(R.id.widget_quick_2, p2);
                }
            }
        } catch (Exception ignored) {}

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
