package de.taktwerk.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import androidx.core.app.NotificationCompat;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class TimerNotificationActionReceiver extends BroadcastReceiver {

    public static final String ACTION_LOCKSCREEN_TIMER_CONTROL = "de.taktwerk.app.ACTION_LOCKSCREEN_TIMER_CONTROL";
    public static final String EXTRA_TIMER_ACTION = "timerAction";
    public static final String TIMER_CHANNEL_ID = "taktwerk_active_timer_v3";
    public static final int TIMER_NOTIFICATION_ID = 4102;

    private static final String PREFS_NAME = "taktwerk_timer_notif_prefs";
    private static final String KEY_HAS_TIMER = "has_timer";
    private static final String KEY_TITLE = "title";
    private static final String KEY_CUSTOMER = "customer";
    private static final String KEY_NOTES = "notes";
    private static final String KEY_START_MS = "start_ms";
    private static final String KEY_ELAPSED_MS = "elapsed_ms";
    private static final String KEY_IS_PAUSED = "is_paused";
    private static final String KEY_PAUSED_DURATION = "paused_duration";
    private static final String KEY_LOCKSCREEN_CONTROLS = "lockscreen_controls";
    private static final String KEY_PENDING_ACTIONS_JSON = "pending_actions_json";

    private static final Object QUEUE_LOCK = new Object();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }
        if (!ACTION_LOCKSCREEN_TIMER_CONTROL.equals(intent.getAction())) {
            return;
        }
        String timerAction = intent.getStringExtra(EXTRA_TIMER_ACTION);
        if (timerAction == null) {
            return;
        }
        timerAction = timerAction.trim().toLowerCase(Locale.ROOT);
        if (!"pause".equals(timerAction) && !"resume".equals(timerAction) && !"stop".equals(timerAction)) {
            return;
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean controlsAllowed = prefs.getBoolean(KEY_LOCKSCREEN_CONTROLS, true);
        if (!controlsAllowed) {
            return;
        }

        long nowMs = System.currentTimeMillis();
        enqueueAction(context, timerAction, nowMs);

        // Provide immediate optimistic notification & haptic feedback directly on the lockscreen
        boolean hasTimer = prefs.getBoolean(KEY_HAS_TIMER, false);
        if (hasTimer) {
            String title = prefs.getString(KEY_TITLE, "Arbeitszeit");
            String customer = prefs.getString(KEY_CUSTOMER, "");
            String notes = prefs.getString(KEY_NOTES, "");
            long startMs = prefs.getLong(KEY_START_MS, nowMs);
            long elapsedMsAtPause = prefs.getLong(KEY_ELAPSED_MS, 0L);
            boolean currentlyPaused = prefs.getBoolean(KEY_IS_PAUSED, false);

            if ("pause".equals(timerAction) && !currentlyPaused) {
                long elapsedMs = Math.max(0L, nowMs - startMs);
                String formattedDur = formatDurationSeconds(elapsedMs / 1000L);
                saveTimerSnapshot(
                    context,
                    title,
                    customer,
                    notes,
                    startMs,
                    elapsedMs,
                    true,
                    formattedDur,
                    true
                );
                postTimerNotification(
                    context,
                    title,
                    customer,
                    notes,
                    startMs,
                    true,
                    formattedDur,
                    true
                );
                vibrateFeedback(context, "start");
            } else if ("resume".equals(timerAction) && currentlyPaused) {
                long adjustedStartMs = nowMs - Math.max(0L, elapsedMsAtPause);
                saveTimerSnapshot(
                    context,
                    title,
                    customer,
                    notes,
                    adjustedStartMs,
                    elapsedMsAtPause,
                    false,
                    "",
                    true
                );
                postTimerNotification(
                    context,
                    title,
                    customer,
                    notes,
                    adjustedStartMs,
                    false,
                    "",
                    true
                );
                vibrateFeedback(context, "start");
            } else if ("stop".equals(timerAction)) {
                clearTimerSnapshot(context);
                NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager != null) {
                    manager.cancel(TIMER_NOTIFICATION_ID);
                }
                vibrateFeedback(context, "stop");
            }
        } else if ("stop".equals(timerAction)) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.cancel(TIMER_NOTIFICATION_ID);
            }
            vibrateFeedback(context, "stop");
        }

        TaktWerkNativePlugin.dispatchTimerActionFromReceiver(timerAction, nowMs);
    }

    public static void saveTimerSnapshot(
        Context context,
        String title,
        String customer,
        String notes,
        long startTimeMs,
        long elapsedMs,
        boolean isPaused,
        String pausedDuration,
        boolean lockscreenControls
    ) {
        if (context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putBoolean(KEY_HAS_TIMER, true)
            .putString(KEY_TITLE, title != null ? title : "Arbeitszeit")
            .putString(KEY_CUSTOMER, customer != null ? customer : "")
            .putString(KEY_NOTES, notes != null ? notes : "")
            .putLong(KEY_START_MS, startTimeMs)
            .putLong(KEY_ELAPSED_MS, Math.max(0L, elapsedMs))
            .putBoolean(KEY_IS_PAUSED, isPaused)
            .putString(KEY_PAUSED_DURATION, pausedDuration != null ? pausedDuration : "")
            .putBoolean(KEY_LOCKSCREEN_CONTROLS, lockscreenControls)
            .apply();
    }

    public static void clearTimerSnapshot(Context context) {
        if (context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putBoolean(KEY_HAS_TIMER, false)
            .apply();
    }

    public static void enqueueAction(Context context, String action, long timestampMs) {
        if (context == null || action == null || action.trim().isEmpty()) return;
        synchronized (QUEUE_LOCK) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String existingRaw = prefs.getString(KEY_PENDING_ACTIONS_JSON, "[]");
            JSONArray arr;
            try {
                arr = new JSONArray(existingRaw);
            } catch (JSONException e) {
                arr = new JSONArray();
            }
            try {
                JSONObject item = new JSONObject();
                item.put("id", timestampMs + "-" + UUID.randomUUID().toString().substring(0, 8));
                item.put("action", action.trim());
                item.put("timestampMs", timestampMs);
                arr.put(item);
                prefs.edit().putString(KEY_PENDING_ACTIONS_JSON, arr.toString()).commit();
            } catch (JSONException ignored) {}
        }
    }

    public static JSONArray consumePendingActions(Context context) {
        if (context == null) return new JSONArray();
        synchronized (QUEUE_LOCK) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String existingRaw = prefs.getString(KEY_PENDING_ACTIONS_JSON, "[]");
            prefs.edit().putString(KEY_PENDING_ACTIONS_JSON, "[]").commit();
            try {
                return new JSONArray(existingRaw);
            } catch (JSONException e) {
                return new JSONArray();
            }
        }
    }

    public static boolean postTimerNotification(
        Context context,
        String title,
        String customer,
        String notes,
        long startTimeMs,
        boolean isPaused,
        String pausedDuration,
        boolean lockscreenControls
    ) {
        if (context == null) return false;
        String safeTitle = (title == null || title.trim().isEmpty()) ? "Arbeitszeit" : title;
        String safeCustomer = customer == null ? "" : customer;
        String safeNotes = notes == null ? "" : notes;
        String safePausedDuration = pausedDuration == null ? "" : pausedDuration;

        ensureTimerChannelStatic(context);

        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentPendingIntent = PendingIntent.getActivity(
            context,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String contentTitle = isPaused ? "⏸ Timer pausiert: " + safeTitle : "⏱ " + safeTitle;
        String contentText = isPaused
            ? (safeCustomer.isEmpty() ? "Pausiert bei " + safePausedDuration : safeCustomer + " · Pausiert bei " + safePausedDuration)
            : (safeCustomer.isEmpty() ? "TaktWerk Zeiterfassung" : safeCustomer);

        NotificationCompat.BigTextStyle bigTextStyle = new NotificationCompat.BigTextStyle()
            .setBigContentTitle(contentTitle)
            .bigText(contentText + (safeNotes.isEmpty() ? "" : "\n" + safeNotes))
            .setSummaryText(isPaused ? "Pausiert (" + safePausedDuration + ")" : "Zeiterfassung aktiv");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, TIMER_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setColor(0xFF7C3AED)
            .setColorized(true)
            .setContentTitle(contentTitle)
            .setContentText(contentText)
            .setSubText(isPaused ? "Pausiert" : "Zeiterfassung")
            .setStyle(bigTextStyle)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setContentIntent(contentPendingIntent)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);

        if (lockscreenControls) {
            builder.setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

            // Broadcast-based Pause / Resume button (executes directly from lockscreen without unlocking)
            Intent pauseResumeIntent = new Intent(context, TimerNotificationActionReceiver.class);
            pauseResumeIntent.setAction(ACTION_LOCKSCREEN_TIMER_CONTROL);
            pauseResumeIntent.putExtra(EXTRA_TIMER_ACTION, isPaused ? "resume" : "pause");
            PendingIntent pauseResumePendingIntent = PendingIntent.getBroadcast(
                context,
                201,
                pauseResumeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            NotificationCompat.Action pauseResumeAction = new NotificationCompat.Action.Builder(
                isPaused ? R.drawable.ic_action_play : R.drawable.ic_action_pause,
                isPaused ? "Fortsetzen" : "Pausieren",
                pauseResumePendingIntent
            )
                .setAuthenticationRequired(false)
                .build();
            builder.addAction(pauseResumeAction);

            // Broadcast-based Stop & Save button (executes directly from lockscreen without unlocking)
            Intent stopIntent = new Intent(context, TimerNotificationActionReceiver.class);
            stopIntent.setAction(ACTION_LOCKSCREEN_TIMER_CONTROL);
            stopIntent.putExtra(EXTRA_TIMER_ACTION, "stop");
            PendingIntent stopPendingIntent = PendingIntent.getBroadcast(
                context,
                202,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            NotificationCompat.Action stopAction = new NotificationCompat.Action.Builder(
                R.drawable.ic_action_stop,
                "Stoppen & Speichern",
                stopPendingIntent
            )
                .setAuthenticationRequired(false)
                .build();
            builder.addAction(stopAction);
        } else {
            // Private lockscreen mode: hide project details & omit lockscreen control buttons
            Notification publicNotification = new NotificationCompat.Builder(context, TIMER_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_timer)
                .setColor(0xFF7C3AED)
                .setContentTitle("TaktWerk Zeiterfassung")
                .setContentText(isPaused ? "Timer pausiert (Entsperren zum Steuern)" : "Timer aktiv (Entsperren zum Steuern)")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                .build();

            builder
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(publicNotification);
        }

        if (!isPaused) {
            builder.setWhen(startTimeMs).setShowWhen(true).setUsesChronometer(true);
        } else {
            builder.setUsesChronometer(false).setShowWhen(false);
        }

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(TIMER_NOTIFICATION_ID, builder.build());
            return true;
        }
        return false;
    }

    private static void ensureTimerChannelStatic(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;
            NotificationChannel existing = manager.getNotificationChannel(TIMER_CHANNEL_ID);
            if (existing == null) {
                NotificationChannel channel = new NotificationChannel(
                    TIMER_CHANNEL_ID,
                    "Laufende Zeiterfassung",
                    NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Zeigt den aktuell laufenden Timer prominent oben in der Benachrichtigungsleiste und auf dem Sperrbildschirm an.");
                channel.setShowBadge(true);
                channel.setSound(null, null);
                channel.enableVibration(false);
                channel.enableLights(false);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                manager.createNotificationChannel(channel);
            }
        }
    }

    private static String formatDurationSeconds(long totalSec) {
        long safe = Math.max(0L, totalSec);
        long hours = safe / 3600L;
        long minutes = (safe % 3600L) / 60L;
        long seconds = safe % 60L;
        return String.format(Locale.ROOT, "%02d:%02d:%02d", hours, minutes, seconds);
    }

    private static void vibrateFeedback(Context context, String pattern) {
        try {
            Vibrator vibrator;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = vm != null ? vm.getDefaultVibrator() : null;
            } else {
                vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (vibrator != null && vibrator.hasVibrator()) {
                if ("stop".equals(pattern)) {
                    long[] timings = new long[] { 0, 55, 70, 55 };
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator.vibrate(VibrationEffect.createWaveform(timings, -1));
                    } else {
                        vibrator.vibrate(timings, -1);
                    }
                } else {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator.vibrate(VibrationEffect.createOneShot(65, VibrationEffect.DEFAULT_AMPLITUDE));
                    } else {
                        vibrator.vibrate(65);
                    }
                }
            }
        } catch (Exception ignored) {}
    }
}
