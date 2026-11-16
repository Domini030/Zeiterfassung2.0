package de.taktwerk.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

public class TimerReminderReceiver extends BroadcastReceiver {

    private static final int REMINDER_NOTIFICATION_ID = 4109;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                return;
            }
        }

        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        String soundPreset = intent.getStringExtra("soundPreset");
        if (title == null || title.trim().isEmpty()) {
            title = "TaktWerk Erinnerung";
        }
        if (body == null || body.trim().isEmpty()) {
            body = "Deine Aufgabe läuft noch — bitte prüfen oder stoppen.";
        }
        if (soundPreset == null || soundPreset.trim().isEmpty()) {
            soundPreset = "chime";
        }

        boolean isSilent = "silent".equals(soundPreset);
        String channelId = isSilent
            ? "taktwerk_reminder_silent_v1"
            : ("alarm".equals(soundPreset) ? "taktwerk_reminder_alarm_v1" : "taktwerk_reminder_sound_v1");

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel existing = manager.getNotificationChannel(channelId);
            if (existing == null) {
                NotificationChannel channel = new NotificationChannel(
                    channelId,
                    isSilent ? "Aufgaben-Erinnerungen (Lautlos)" : "Aufgaben-Erinnerungen (mit Ton)",
                    NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Erinnert automatisch an laufende Zeiterfassungs-Aufgaben.");
                channel.enableVibration(!isSilent);
                if (isSilent) {
                    channel.setSound(null, null);
                } else {
                    Uri soundUri = "alarm".equals(soundPreset)
                        ? RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                        : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                    if (soundUri == null) {
                        soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                    }
                    AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage("alarm".equals(soundPreset)
                            ? AudioAttributes.USAGE_ALARM
                            : AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                    channel.setSound(soundUri, attrs);
                }
                manager.createNotificationChannel(channel);
            }
        }

        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            4109,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setColor(0xFF7C3AED)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent);

        if (isSilent) {
            builder.setSilent(true);
        }

        manager.notify(REMINDER_NOTIFICATION_ID, builder.build());
    }
}
