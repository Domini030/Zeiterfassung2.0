package de.taktwerk.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Lightweight 24 kHz PCM musical tone synthesizer for built-in TaktWerk notification presets.
 * Ensures every built-in sound plays cleanly and distinctly on Android (including lock-screen reminders).
 */
public final class ReminderToneSynth {

    private static final int SAMPLE_RATE = 24000;
    private static final ExecutorService AUDIO_EXECUTOR = Executors.newSingleThreadExecutor();
    private static final Object LOCK = new Object();
    private static volatile AudioTrack activeTrack = null;

    private ReminderToneSynth() {}

    public static void stopCurrent() {
        synchronized (LOCK) {
            if (activeTrack != null) {
                try {
                    if (activeTrack.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) {
                        activeTrack.stop();
                    }
                } catch (Exception ignored) {}
                try {
                    activeTrack.release();
                } catch (Exception ignored) {}
                activeTrack = null;
            }
        }
    }

    public static void playPresetAsync(Context context, String preset, boolean respectRingerMode) {
        if (context == null || preset == null || "silent".equals(preset)) {
            return;
        }
        final Context appCtx = context.getApplicationContext();
        AUDIO_EXECUTOR.execute(() -> {
            try {
                if (respectRingerMode) {
                    AudioManager am = (AudioManager) appCtx.getSystemService(Context.AUDIO_SERVICE);
                    if (am != null && am.getRingerMode() != AudioManager.RINGER_MODE_NORMAL) {
                        return;
                    }
                }

                short[] pcm = renderPreset(preset);
                if (pcm == null || pcm.length == 0) {
                    return;
                }

                stopCurrent();

                int usage = "alarm".equals(preset)
                    ? AudioAttributes.USAGE_ALARM
                    : AudioAttributes.USAGE_NOTIFICATION;

                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(usage)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();

                AudioFormat format = new AudioFormat.Builder()
                    .setSampleRate(SAMPLE_RATE)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build();

                int byteLen = pcm.length * 2;
                AudioTrack track = new AudioTrack(
                    attrs,
                    format,
                    byteLen,
                    AudioTrack.MODE_STATIC,
                    AudioManager.AUDIO_SESSION_ID_GENERATE
                );

                track.write(pcm, 0, pcm.length);
                synchronized (LOCK) {
                    activeTrack = track;
                }
                track.play();

                long durationMs = (long) ((pcm.length * 1000L) / SAMPLE_RATE) + 120L;
                try {
                    Thread.sleep(durationMs);
                } catch (InterruptedException ignored) {}

                synchronized (LOCK) {
                    if (activeTrack == track) {
                        try {
                            track.stop();
                        } catch (Exception ignored) {}
                        try {
                            track.release();
                        } catch (Exception ignored) {}
                        activeTrack = null;
                    }
                }
            } catch (Exception ignored) {}
        });
    }

    private static short[] renderPreset(String preset) {
        double totalSec = 0.95;
        if ("alarm".equals(preset) || "sonar".equals(preset) || "fanfare".equals(preset)) {
            totalSec = 1.05;
        } else if ("woodblock".equals(preset) || "droplet".equals(preset)) {
            totalSec = 0.55;
        }
        double[] mix = new double[(int) (SAMPLE_RATE * totalSec)];

        switch (preset) {
            case "popcorn":
                addNote(mix, 698.46, 0.0, 0.095, 0.42, false);
                addNote(mix, 1396.91, 0.0, 0.05, 0.14, true);
                addNote(mix, 880.0, 0.095, 0.095, 0.45, false);
                addNote(mix, 1046.5, 0.19, 0.24, 0.44, false);
                addNote(mix, 2093.0, 0.19, 0.12, 0.12, false);
                break;

            case "eureka":
                addNote(mix, 659.25, 0.0, 0.15, 0.34, false);
                addNote(mix, 830.61, 0.08, 0.17, 0.36, false);
                addNote(mix, 987.77, 0.16, 0.21, 0.38, false);
                addNote(mix, 1318.51, 0.24, 0.45, 0.42, false);
                addNote(mix, 2637.02, 0.24, 0.22, 0.10, false);
                break;

            case "chord":
                addNote(mix, 523.25, 0.0, 0.72, 0.26, false);
                addNote(mix, 659.25, 0.03, 0.72, 0.24, false);
                addNote(mix, 783.99, 0.06, 0.72, 0.22, false);
                addNote(mix, 987.77, 0.09, 0.75, 0.16, true);
                break;

            case "droplet":
                addGlide(mix, 520.0, 1240.0, 0.0, 0.15, 0.45);
                addGlide(mix, 680.0, 1520.0, 0.17, 0.17, 0.38);
                break;

            case "crystal":
                addNote(mix, 1318.51, 0.0, 0.56, 0.34, false);
                addNote(mix, 2637.02, 0.0, 0.34, 0.12, false);
                addNote(mix, 1975.53, 0.12, 0.66, 0.36, false);
                addNote(mix, 3951.07, 0.12, 0.30, 0.09, false);
                break;

            case "marimba":
                addNote(mix, 587.33, 0.0, 0.17, 0.46, true);
                addNote(mix, 1174.66, 0.0, 0.06, 0.15, false);
                addNote(mix, 739.99, 0.13, 0.17, 0.45, true);
                addNote(mix, 880.0, 0.26, 0.36, 0.45, true);
                break;

            case "piano":
                addNote(mix, 523.25, 0.0, 0.52, 0.28, true);
                addNote(mix, 659.25, 0.0, 0.52, 0.25, true);
                addNote(mix, 783.99, 0.0, 0.52, 0.24, false);
                addNote(mix, 1046.5, 0.18, 0.58, 0.30, true);
                break;

            case "woodblock":
                addNote(mix, 720.0, 0.0, 0.06, 0.46, true);
                addNote(mix, 1440.0, 0.0, 0.03, 0.18, false);
                addNote(mix, 960.0, 0.12, 0.07, 0.42, true);
                break;

            case "sonar":
                addNote(mix, 440.0, 0.0, 0.46, 0.44, false);
                addNote(mix, 880.0, 0.0, 0.22, 0.12, false);
                addNote(mix, 440.0, 0.40, 0.52, 0.20, false);
                break;

            case "fanfare":
                addNote(mix, 523.25, 0.0, 0.15, 0.38, true);
                addNote(mix, 659.25, 0.11, 0.15, 0.38, true);
                addNote(mix, 783.99, 0.22, 0.17, 0.40, true);
                addNote(mix, 1046.5, 0.34, 0.50, 0.44, true);
                addNote(mix, 1046.5, 0.34, 0.50, 0.20, false);
                break;

            case "bell":
                addNote(mix, 880.0, 0.0, 0.78, 0.46, true);
                addNote(mix, 1760.0, 0.0, 0.42, 0.20, false);
                break;

            case "pulse":
                addNote(mix, 660.0, 0.0, 0.15, 0.44, false);
                addNote(mix, 660.0, 0.20, 0.19, 0.44, false);
                break;

            case "alarm":
                addNote(mix, 740.0, 0.0, 0.18, 0.48, true);
                addNote(mix, 987.77, 0.20, 0.18, 0.48, true);
                addNote(mix, 740.0, 0.42, 0.18, 0.48, true);
                addNote(mix, 987.77, 0.62, 0.28, 0.48, true);
                break;

            case "chime":
            default:
                addNote(mix, 523.25, 0.0, 0.26, 0.38, false);
                addNote(mix, 659.25, 0.14, 0.30, 0.38, false);
                addNote(mix, 783.99, 0.28, 0.48, 0.42, false);
                break;
        }

        short[] pcm = new short[mix.length];
        for (int i = 0; i < mix.length; i++) {
            double clamped = Math.max(-0.98, Math.min(0.98, mix[i]));
            pcm[i] = (short) (clamped * 32767.0);
        }
        return pcm;
    }

    private static void addNote(
        double[] buffer,
        double freqHz,
        double startSec,
        double durSec,
        double gain,
        boolean triangle
    ) {
        int startIdx = Math.max(0, (int) (startSec * SAMPLE_RATE));
        int length = (int) (durSec * SAMPLE_RATE);
        int endIdx = Math.min(buffer.length, startIdx + length);
        double attackSamples = Math.max(24.0, Math.min(length * 0.25, SAMPLE_RATE * 0.012));

        for (int i = startIdx; i < endIdx; i++) {
            int local = i - startIdx;
            double t = (double) local / SAMPLE_RATE;
            double env = local < attackSamples
                ? (local / attackSamples)
                : Math.exp(-5.2 * ((local - attackSamples) / Math.max(1.0, length - attackSamples)));

            double phase = (freqHz * t) % 1.0;
            double sample = triangle
                ? (4.0 * Math.abs(phase - 0.5) - 1.0)
                : Math.sin(2.0 * Math.PI * freqHz * t);

            buffer[i] += sample * gain * env;
        }
    }

    private static void addGlide(
        double[] buffer,
        double startFreqHz,
        double endFreqHz,
        double startSec,
        double durSec,
        double gain
    ) {
        int startIdx = Math.max(0, (int) (startSec * SAMPLE_RATE));
        int length = (int) (durSec * SAMPLE_RATE);
        int endIdx = Math.min(buffer.length, startIdx + length);
        double attackSamples = Math.max(24.0, SAMPLE_RATE * 0.010);
        double phaseRad = 0.0;

        for (int i = startIdx; i < endIdx; i++) {
            int local = i - startIdx;
            double progress = (double) local / Math.max(1, length);
            double freq = startFreqHz * Math.pow(endFreqHz / startFreqHz, progress);
            phaseRad += (2.0 * Math.PI * freq) / SAMPLE_RATE;

            double env = local < attackSamples
                ? (local / attackSamples)
                : Math.exp(-4.8 * ((local - attackSamples) / Math.max(1.0, length - attackSamples)));

            buffer[i] += Math.sin(phaseRad) * gain * env;
        }
    }
}
