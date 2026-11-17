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
import java.util.List;

public class TimerReminderReceiver extends BroadcastReceiver {

    private static final int REMINDER_NOTIFICATION_ID = 4109;
    private static final String SYS_CHANNEL_PREFIX = "taktwerk_reminder_sys_";

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
        String systemSoundUriStr = intent.getStringExtra("systemSoundUri");

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
        boolean isDeviceSound = "device".equals(soundPreset);
        boolean isAlarm = "alarm".equals(soundPreset);
        boolean playCustomSynth = !isSilent && !isDeviceSound && !isAlarm;

        Uri resolvedDeviceUri = null;
        if (isDeviceSound) {
            if (systemSoundUriStr != null && !systemSoundUriStr.trim().isEmpty()) {
                try {
                    resolvedDeviceUri = Uri.parse(systemSoundUriStr.trim());
                } catch (Exception ignored) {}
            }
            if (resolvedDeviceUri == null) {
                resolvedDeviceUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
        }

        String channelId;
        if (isSilent) {
            channelId = "taktwerk_reminder_silent_v1";
        } else if (isDeviceSound) {
            String uriKey = resolvedDeviceUri != null ? resolvedDeviceUri.toString() : "default";
            channelId = SYS_CHANNEL_PREFIX + Integer.toHexString(uriKey.hashCode());
        } else if (isAlarm) {
            channelId = "taktwerk_reminder_alarm_v1";
        } else {
            channelId = "taktwerk_reminder_custom_v1";
        }

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (isDeviceSound) {
                // Keep channel list clean and ensure Android 8+ never plays a stale cached sound
                try {
                    List<NotificationChannel> allChannels = manager.getNotificationChannels();
                    if (allChannels != null) {
                        for (NotificationChannel ch : allChannels) {
                            if (ch != null && ch.getId() != null
                                && ch.getId().startsWith(SYS_CHANNEL_PREFIX)
                                && !channelId.equals(ch.getId())) {
                                manager.deleteNotificationChannel(ch.getId());
                            }
                        }
                    }
                } catch (Exception ignored) {}
            }

            NotificationChannel existing = manager.getNotificationChannel(channelId);
            if (existing == null) {
                String channelName = isSilent
                    ? "Aufgaben-Erinnerungen (Lautlos)"
                    : (isDeviceSound
                        ? "Aufgaben-Erinnerungen (System-/Pixel-Ton)"
                        : (isAlarm
                            ? "Aufgaben-Erinnerungen (Alarm)"
                            : "Aufgaben-Erinnerungen (TaktWerk-Ton)"));
                NotificationChannel channel = new NotificationChannel(
                    channelId,
                    channelName,
                    NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Erinnert automatisch an laufende Zeiterfassungs-Aufgaben.");
                channel.enableVibration(!isSilent);
                if (isSilent || playCustomSynth) {
                    channel.setSound(null, null);
                } else {
                    Uri soundUri = isDeviceSound
                        ? resolvedDeviceUri
                        : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                    if (soundUri == null) {
                        soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                    }
                    AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(isAlarm
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
        } else if (isDeviceSound && resolvedDeviceUri != null) {
            builder.setSound(resolvedDeviceUri);
        }

        manager.notify(REMINDER_NOTIFICATION_ID, builder.build());

        if (playCustomSynth) {
            ReminderToneSynth.playPresetAsync(context, soundPreset, true);
        }
    }
}
