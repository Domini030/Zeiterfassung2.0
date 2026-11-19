package de.taktwerk.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import java.lang.ref.WeakReference;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

public final class GeoFenceEngine {

    public static final String PREFS_NAME = "taktwerk_geofence";
    public static final String ACTION_PROXIMITY_ALERT = "de.taktwerk.app.ACTION_GEOFENCE_PROXIMITY";

    public static final String MONITOR_CHANNEL_ID = "taktwerk_geofence_monitor_v1";
    public static final String EVENT_CHANNEL_ID = "taktwerk_geofence_events_v1";
    public static final String TIMER_CHANNEL_ID = "taktwerk_active_timer_v3";

    public static final int MONITOR_NOTIFICATION_ID = 4114;
    public static final int EVENT_NOTIFICATION_ID = 4115;
    public static final int TIMER_NOTIFICATION_ID = 4102;

    private static final long COOLDOWN_MS = 10L * 60L * 1000L;
    private static final Object LOCK = new Object();

    private static WeakReference<TaktWerkNativePlugin> activePluginRef = new WeakReference<>(null);
    private static long lastEvaluationMs = 0L;

    private GeoFenceEngine() {}

    public static void setActivePlugin(TaktWerkNativePlugin plugin) {
        activePluginRef = new WeakReference<>(plugin);
    }

    public static boolean hasForegroundLocationPermission(Context context) {
        if (context == null) return false;
        boolean fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
        return fine || coarse;
    }

    public static boolean hasFineLocationPermission(Context context) {
        if (context == null) return false;
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    public static boolean hasBackgroundLocationPermission(Context context) {
        if (context == null || !hasForegroundLocationPermission(context)) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return true;
        }
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    public static boolean isGpsEnabled(Context context) {
        if (context == null) return false;
        LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return false;
        try {
            return lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
                || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception ignored) {
            return false;
        }
    }

    public static boolean isBatteryOptimizationIgnored(Context context) {
        if (context == null) return true;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
        } catch (Exception ignored) {
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    public static boolean isMonitorServiceRunning(Context context) {
        if (context == null) return false;
        try {
            ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) return false;
            for (ActivityManager.RunningServiceInfo info : am.getRunningServices(Integer.MAX_VALUE)) {
                if (GeoFenceMonitorService.class.getName().equals(info.service.getClassName())) {
                    return true;
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    public static boolean isMonitoringActive(Context context) {
        if (context == null) return false;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean("enabled", false)) return false;
        try {
            JSONArray rules = new JSONArray(prefs.getString("rulesJson", "[]"));
            return rules.length() > 0;
        } catch (Exception ignored) {
            return false;
        }
    }

    public static int getMonitorIntervalSec(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return Math.max(20, prefs.getInt("intervalSec", 60));
    }

    public static int getRuleCount(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        try {
            return new JSONArray(prefs.getString("rulesJson", "[]")).length();
        } catch (Exception ignored) {
            return 0;
        }
    }

    public static void saveConfig(
        Context context,
        boolean enabled,
        int intervalSec,
        String exitConfirmMode,
        boolean hasActiveTimer,
        String activeGeoRuleId,
        String soundPreset,
        String systemSoundUri,
        String rulesJson
    ) {
        synchronized (LOCK) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String prevActiveGeoId = prefs.getString("activeGeoRuleId", "");
            SharedPreferences.Editor ed = prefs.edit();
            ed.putBoolean("enabled", enabled);
            ed.putInt("intervalSec", Math.max(20, intervalSec));
            ed.putString("exitConfirmMode", "auto".equals(exitConfirmMode) ? "auto" : "ask");
            ed.putBoolean("hasActiveTimer", hasActiveTimer);
            ed.putString("activeGeoRuleId", activeGeoRuleId != null ? activeGeoRuleId : "");
            ed.putString("soundPreset", soundPreset != null ? soundPreset : "chime");
            ed.putString("systemSoundUri", systemSoundUri != null ? systemSoundUri : "");
            ed.putString("rulesJson", rulesJson != null ? rulesJson : "[]");

            // If JS stopped a geo-timer, set cooldown for that rule natively as well
            if (!hasActiveTimer && prevActiveGeoId != null && !prevActiveGeoId.isEmpty()) {
                try {
                    JSONObject cooldowns = new JSONObject(prefs.getString("cooldownsJson", "{}"));
                    cooldowns.put(prevActiveGeoId, System.currentTimeMillis());
                    ed.putString("cooldownsJson", cooldowns.toString());
                } catch (Exception ignored) {}
                ed.putString("exitPromptedRuleId", "");
            }
            if (!hasActiveTimer) {
                ed.putString("exitPromptedRuleId", "");
            }
            ed.apply();
        }
    }

    public static void syncMonitoringFromPrefs(Context context) {
        if (context == null) return;
        boolean shouldMonitor = isMonitoringActive(context);
        boolean hasFg = hasForegroundLocationPermission(context);

        if (shouldMonitor && hasFg) {
            registerProximityAlerts(context);
            startMonitorService(context);
        } else {
            unregisterProximityAlerts(context);
            stopMonitorService(context);
        }
    }

    public static void startMonitorService(Context context) {
        if (context == null || !hasForegroundLocationPermission(context) || !isMonitoringActive(context)) {
            return;
        }
        try {
            Intent intent = new Intent(context, GeoFenceMonitorService.class);
            ContextCompat.startForegroundService(context, intent);
        } catch (Exception ignored) {
            // Android 14+ may block starting a location foreground service from background
            // if ACCESS_BACKGROUND_LOCATION has not been granted yet.
        }
    }

    public static void stopMonitorService(Context context) {
        if (context == null) return;
        try {
            context.stopService(new Intent(context, GeoFenceMonitorService.class));
        } catch (Exception ignored) {}
    }

    @SuppressLint("MissingPermission")
    public static void registerProximityAlerts(Context context) {
        if (context == null || !hasForegroundLocationPermission(context)) return;
        LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return;

        unregisterProximityAlerts(context);

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean("enabled", false)) return;

        try {
            JSONArray rules = new JSONArray(prefs.getString("rulesJson", "[]"));
            int registeredCount = 0;
            for (int i = 0; i < rules.length(); i++) {
                JSONObject r = rules.optJSONObject(i);
                if (r == null) continue;
                String id = r.optString("id", "");
                double lat = r.optDouble("lat", Double.NaN);
                double lng = r.optDouble("lng", Double.NaN);
                float radius = (float) Math.max(30.0, r.optDouble("radiusMeters", 120.0));
                if (id.isEmpty() || Double.isNaN(lat) || Double.isNaN(lng)) continue;

                Intent intent = new Intent(context, GeoFenceReceiver.class);
                intent.setAction(ACTION_PROXIMITY_ALERT);
                intent.putExtra("ruleId", id);

                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    flags |= PendingIntent.FLAG_MUTABLE;
                }
                PendingIntent pi = PendingIntent.getBroadcast(context, 6200 + i, intent, flags);
                lm.addProximityAlert(lat, lng, radius, -1L, pi);
                registeredCount++;
            }
            prefs.edit().putInt("registeredProximityCount", registeredCount).apply();
        } catch (Exception ignored) {}
    }

    @SuppressLint("MissingPermission")
    public static void unregisterProximityAlerts(Context context) {
        if (context == null) return;
        LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int prevCount = prefs.getInt("registeredProximityCount", 0);
        int limit = Math.max(prevCount, 20);
        for (int i = 0; i < limit; i++) {
            try {
                Intent intent = new Intent(context, GeoFenceReceiver.class);
                intent.setAction(ACTION_PROXIMITY_ALERT);
                int flags = PendingIntent.FLAG_NO_CREATE;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    flags |= PendingIntent.FLAG_MUTABLE;
                }
                PendingIntent existing = PendingIntent.getBroadcast(context, 6200 + i, intent, flags);
                if (existing != null) {
                    lm.removeProximityAlert(existing);
                    existing.cancel();
                }
            } catch (Exception ignored) {}
        }
        prefs.edit().putInt("registeredProximityCount", 0).apply();
    }

    @SuppressLint("MissingPermission")
    public static Location getBestLastKnownLocation(Context context, long maxAgeMs) {
        if (context == null || !hasForegroundLocationPermission(context)) return null;
        LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return null;

        Location best = null;
        long now = System.currentTimeMillis();
        try {
            for (String provider : lm.getProviders(true)) {
                try {
                    Location l = lm.getLastKnownLocation(provider);
                    if (l == null) continue;
                    if (maxAgeMs > 0 && (now - l.getTime()) > maxAgeMs) continue;
                    if (best == null) {
                        best = l;
                    } else {
                        long lAge = Math.max(0L, now - l.getTime());
                        long bAge = Math.max(0L, now - best.getTime());
                        boolean lMuchNewer = lAge + 60_000L < bAge;
                        boolean bMuchNewer = bAge + 60_000L < lAge;
                        if (lMuchNewer || (!bMuchNewer && l.getAccuracy() < best.getAccuracy())) {
                            best = l;
                        }
                    }
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
        return best;
    }

    public static Location getRuleFallbackLocation(Context context, String ruleId) {
        if (context == null || ruleId == null || ruleId.isEmpty()) return null;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        try {
            JSONArray rules = new JSONArray(prefs.getString("rulesJson", "[]"));
            for (int i = 0; i < rules.length(); i++) {
                JSONObject r = rules.optJSONObject(i);
                if (r != null && ruleId.equals(r.optString("id", ""))) {
                    Location loc = new Location("proximity_fallback");
                    loc.setLatitude(r.optDouble("lat", 0.0));
                    loc.setLongitude(r.optDouble("lng", 0.0));
                    loc.setAccuracy(25f);
                    loc.setTime(System.currentTimeMillis());
                    return loc;
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    public static void evaluateLocation(Context context, Location loc, boolean throttle) {
        if (context == null || loc == null) return;
        long nowMs = System.currentTimeMillis();
        if (throttle && (nowMs - lastEvaluationMs) < 10_000L) {
            return;
        }

        JSObject eventToEmit = null;
        synchronized (LOCK) {
            if (throttle && (nowMs - lastEvaluationMs) < 10_000L) {
                return;
            }
            lastEvaluationMs = nowMs;

            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            if (!prefs.getBoolean("enabled", false)) return;

            JSONArray rules;
            try {
                rules = new JSONArray(prefs.getString("rulesJson", "[]"));
            } catch (Exception ignored) {
                return;
            }
            if (rules.length() == 0) return;

            boolean hasActiveTimer = prefs.getBoolean("hasActiveTimer", false);
            String activeGeoRuleId = prefs.getString("activeGeoRuleId", "");
            String exitConfirmMode = prefs.getString("exitConfirmMode", "ask");
            String exitPromptedRuleId = prefs.getString("exitPromptedRuleId", "");

            JSONObject cooldowns;
            try {
                cooldowns = new JSONObject(prefs.getString("cooldownsJson", "{}"));
            } catch (Exception ignored) {
                cooldowns = new JSONObject();
            }

            // 1. Check auto-stop / exit when a geo-started timer is currently active
            if (hasActiveTimer && activeGeoRuleId != null && !activeGeoRuleId.isEmpty()) {
                JSONObject runningRule = null;
                for (int i = 0; i < rules.length(); i++) {
                    JSONObject r = rules.optJSONObject(i);
                    if (r != null && activeGeoRuleId.equals(r.optString("id", ""))) {
                        runningRule = r;
                        break;
                    }
                }
                if (runningRule != null && runningRule.optBoolean("autoStopOnExit", false)) {
                    double rLat = runningRule.optDouble("lat", 0.0);
                    double rLng = runningRule.optDouble("lng", 0.0);
                    double radius = Math.max(30.0, runningRule.optDouble("radiusMeters", 120.0));
                    double dist = distanceMeters(loc.getLatitude(), loc.getLongitude(), rLat, rLng);
                    boolean accuracyAcceptable = !loc.hasAccuracy() || loc.getAccuracy() <= Math.max(150f, (float) radius);
                    if (accuracyAcceptable && dist > radius * 1.35) {
                        String ruleName = runningRule.optString("name", "Standort");
                        String taskTitle = runningRule.optString("taskTitle", ruleName);
                        if (taskTitle.isEmpty()) taskTitle = ruleName;

                        if ("auto".equals(exitConfirmMode)) {
                            try {
                                cooldowns.put(activeGeoRuleId, nowMs);
                            } catch (Exception ignored) {}
                            SharedPreferences.Editor ed = prefs.edit();
                            ed.putBoolean("hasActiveTimer", false);
                            ed.putString("activeGeoRuleId", "");
                            ed.putString("exitPromptedRuleId", "");
                            ed.putString("cooldownsJson", cooldowns.toString());

                            JSONObject ev = buildEventJson(
                                "exit_auto",
                                runningRule,
                                loc,
                                dist,
                                nowMs
                            );
                            appendPendingEvent(prefs, ed, ev);
                            ed.apply();

                            clearActiveTimerNotification(context);
                            updateWidgetForStop(context);
                            vibratePattern(context, "stop");
                            postGeoAlertNotification(
                                context,
                                "Ortsautomatik: Aufgabe gestoppt",
                                "Ortsbereich „" + ruleName + "“ verlassen (" + Math.round(dist) + " m) – „" + taskTitle + "“ gespeichert."
                            );
                            eventToEmit = toJSObject(ev);
                        } else if (!activeGeoRuleId.equals(exitPromptedRuleId)) {
                            SharedPreferences.Editor ed = prefs.edit();
                            ed.putString("exitPromptedRuleId", activeGeoRuleId);
                            JSONObject ev = buildEventJson(
                                "exit_ask",
                                runningRule,
                                loc,
                                dist,
                                nowMs
                            );
                            appendPendingEvent(prefs, ed, ev);
                            ed.apply();

                            vibratePattern(context, "stop");
                            postGeoAlertNotification(
                                context,
                                "Ortsbereich „" + ruleName + "“ verlassen",
                                "Soll „" + taskTitle + "“ jetzt gestoppt werden? Tippe zum Bestätigen."
                            );
                            eventToEmit = toJSObject(ev);
                        }
                    }
                }
                if (eventToEmit != null) {
                    emitEventIfAlive(eventToEmit);
                }
                return;
            }

            // 2. Manual or NFC timer is already running -> do not override
            if (hasActiveTimer) {
                return;
            }

            // 3. Find closest matching enabled rule within radius
            JSONObject bestRule = null;
            double bestDist = Double.MAX_VALUE;
            for (int i = 0; i < rules.length(); i++) {
                JSONObject r = rules.optJSONObject(i);
                if (r == null) continue;
                String id = r.optString("id", "");
                if (id.isEmpty()) continue;

                double rLat = r.optDouble("lat", Double.NaN);
                double rLng = r.optDouble("lng", Double.NaN);
                double radius = Math.max(30.0, r.optDouble("radiusMeters", 120.0));
                if (Double.isNaN(rLat) || Double.isNaN(rLng)) continue;

                double dist = distanceMeters(loc.getLatitude(), loc.getLongitude(), rLat, rLng);
                if (dist <= radius) {
                    long lastStopMs = cooldowns.optLong(id, 0L);
                    if (lastStopMs > 0L && nowMs < lastStopMs + COOLDOWN_MS) {
                        continue;
                    }
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestRule = r;
                    }
                }
            }

            if (bestRule == null) {
                return;
            }

            String matchedRuleId = bestRule.optString("id", "");
            String ruleName = bestRule.optString("name", "Standort");
            String taskTitle = bestRule.optString("taskTitle", "").trim();
            if (taskTitle.isEmpty()) taskTitle = ruleName;
            String customerName = bestRule.optString("customerName", "").trim();
            String notes = bestRule.optString("notes", "").trim();

            SharedPreferences.Editor ed = prefs.edit();
            ed.putBoolean("hasActiveTimer", true);
            ed.putString("activeGeoRuleId", matchedRuleId);
            ed.putString("exitPromptedRuleId", "");
            JSONObject ev = buildEventJson("enter", bestRule, loc, bestDist, nowMs);
            appendPendingEvent(prefs, ed, ev);
            ed.apply();

            showRunningTimerNotification(context, taskTitle, customerName, notes, nowMs);
            updateWidgetForStart(context, taskTitle, customerName);
            vibratePattern(context, "start");
            postGeoAlertNotification(
                context,
                "Ortsautomatik gestartet",
                "Standort „" + ruleName + "“ (" + Math.round(bestDist) + " m): „" + taskTitle + "“ läuft."
            );
            eventToEmit = toJSObject(ev);
        }

        if (eventToEmit != null) {
            emitEventIfAlive(eventToEmit);
        }
    }

    public static JSONArray consumePendingEvents(Context context) {
        synchronized (LOCK) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String raw = prefs.getString("pendingEventsJson", "[]");
            prefs.edit().putString("pendingEventsJson", "[]").apply();
            try {
                return new JSONArray(raw);
            } catch (Exception ignored) {
                return new JSONArray();
            }
        }
    }

    private static JSONObject buildEventJson(
        String type,
        JSONObject rule,
        Location loc,
        double distMeters,
        long timestampMs
    ) {
        JSONObject ev = new JSONObject();
        try {
            SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            isoFmt.setTimeZone(TimeZone.getTimeZone("UTC"));

            ev.put("eventId", "geo_ev_" + timestampMs + "_" + Math.round(Math.random() * 9999));
            ev.put("type", type);
            ev.put("ruleId", rule.optString("id", ""));
            ev.put("ruleName", rule.optString("name", ""));
            ev.put("taskTitle", rule.optString("taskTitle", ""));
            ev.put("notes", rule.optString("notes", ""));
            ev.put("customerId", rule.optString("customerId", ""));
            ev.put("customerName", rule.optString("customerName", ""));
            ev.put("productId", rule.optString("productId", ""));
            ev.put("hourlyRateNet", rule.optDouble("hourlyRateNet", 0.0));
            ev.put("taxRate", rule.optInt("taxRate", 19));
            ev.put("address", rule.optString("address", ""));
            ev.put("timestampIso", isoFmt.format(new Date(timestampMs)));
            ev.put("timestampMs", timestampMs);
            ev.put("lat", loc.getLatitude());
            ev.put("lng", loc.getLongitude());
            ev.put("accuracyMeters", loc.hasAccuracy() ? Math.round(loc.getAccuracy()) : 25);
            ev.put("distanceMeters", Math.round(distMeters));
        } catch (Exception ignored) {}
        return ev;
    }

    private static void appendPendingEvent(
        SharedPreferences prefs,
        SharedPreferences.Editor ed,
        JSONObject ev
    ) {
        try {
            JSONArray arr = new JSONArray(prefs.getString("pendingEventsJson", "[]"));
            arr.put(ev);
            while (arr.length() > 40) {
                arr.remove(0);
            }
            ed.putString("pendingEventsJson", arr.toString());
        } catch (Exception ignored) {}
    }

    private static JSObject toJSObject(JSONObject json) {
        try {
            return JSObject.fromJSONObject(json);
        } catch (Exception ignored) {
            return new JSObject();
        }
    }

    private static void emitEventIfAlive(JSObject event) {
        TaktWerkNativePlugin plugin = activePluginRef.get();
        if (plugin != null && event != null) {
            plugin.emitGeoFenceEvent(event);
        }
    }

    private static double distanceMeters(double lat1, double lng1, double lat2, double lng2) {
        float[] results = new float[1];
        Location.distanceBetween(lat1, lng1, lat2, lng2, results);
        return results[0];
    }

    public static void ensureMonitorChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;
            if (manager.getNotificationChannel(MONITOR_CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                    MONITOR_CHANNEL_ID,
                    "Ortsautomatik (Hintergrund)",
                    NotificationManager.IMPORTANCE_LOW
                );
                ch.setDescription("Hält die automatische Standort-Zeiterfassung zuverlässig im Hintergrund aktiv.");
                ch.setShowBadge(false);
                ch.setSound(null, null);
                ch.enableVibration(false);
                ch.enableLights(false);
                manager.createNotificationChannel(ch);
            }
        }
    }

    public static Notification buildMonitorNotification(Context context, int ruleCount, int intervalSec) {
        ensureMonitorChannel(context);
        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            context,
            4114,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String sub = ruleCount == 1
            ? "1 Standort-Regel aktiv (Prüfung alle " + intervalSec + " Sek.)"
            : ruleCount + " Standort-Regeln aktiv (Prüfung alle " + intervalSec + " Sek.)";

        return new NotificationCompat.Builder(context, MONITOR_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setColor(0xFF7C3AED)
            .setContentTitle("TaktWerk Ortsautomatik")
            .setContentText(sub)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(pi)
            .build();
    }

    private static void postGeoAlertNotification(Context context, String title, String body) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                    return;
                }
            }
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (manager.getNotificationChannel(EVENT_CHANNEL_ID) == null) {
                    NotificationChannel ch = new NotificationChannel(
                        EVENT_CHANNEL_ID,
                        "Ortsautomatik-Meldungen",
                        NotificationManager.IMPORTANCE_HIGH
                    );
                    ch.setDescription("Benachrichtigt beim automatischen Starten oder Stoppen an gespeicherten Orten.");
                    ch.enableVibration(true);
                    manager.createNotificationChannel(ch);
                }
            }

            Intent openIntent = new Intent(context, MainActivity.class);
            openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(
                context,
                EVENT_NOTIFICATION_ID,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            Notification notif = new NotificationCompat.Builder(context, EVENT_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_timer)
                .setColor(0xFF7C3AED)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build();

            manager.notify(EVENT_NOTIFICATION_ID, notif);
        } catch (Exception ignored) {}
    }

    private static void showRunningTimerNotification(
        Context context,
        String title,
        String customer,
        String notes,
        long startTimeMs
    ) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                    return;
                }
            }
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (manager.getNotificationChannel(TIMER_CHANNEL_ID) == null) {
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

            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            Intent pauseIntent = new Intent(context, MainActivity.class);
            pauseIntent.setAction("de.taktwerk.app.ACTION_TIMER_CONTROL");
            pauseIntent.putExtra("timerAction", "pause");
            pauseIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pausePi = PendingIntent.getActivity(
                context,
                101,
                pauseIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            Intent stopIntent = new Intent(context, MainActivity.class);
            stopIntent.setAction("de.taktwerk.app.ACTION_TIMER_CONTROL");
            stopIntent.putExtra("timerAction", "stop");
            stopIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent stopPi = PendingIntent.getActivity(
                context,
                102,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            String contentTitle = "⏱ " + title;
            String contentText = (customer == null || customer.isEmpty()) ? "Ortsautomatik aktiv" : customer;
            NotificationCompat.BigTextStyle bigStyle = new NotificationCompat.BigTextStyle()
                .setBigContentTitle(contentTitle)
                .bigText(contentText + (notes == null || notes.isEmpty() ? "" : "\n" + notes))
                .setSummaryText("Zeiterfassung aktiv");

            Notification notif = new NotificationCompat.Builder(context, TIMER_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_timer)
                .setColor(0xFF7C3AED)
                .setColorized(true)
                .setContentTitle(contentTitle)
                .setContentText(contentText)
                .setSubText("Ortsautomatik")
                .setStyle(bigStyle)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .addAction(R.drawable.ic_action_pause, "Pausieren", pausePi)
                .addAction(R.drawable.ic_action_stop, "Stoppen & Speichern", stopPi)
                .setWhen(startTimeMs)
                .setShowWhen(true)
                .setUsesChronometer(true)
                .build();

            manager.notify(TIMER_NOTIFICATION_ID, notif);
        } catch (Exception ignored) {}
    }

    private static void clearActiveTimerNotification(Context context) {
        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.cancel(TIMER_NOTIFICATION_ID);
            }
        } catch (Exception ignored) {}
    }

    private static void updateWidgetForStart(Context context, String title, String customerName) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(TaktWerkWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                .putBoolean("isRunning", true)
                .putBoolean("isPaused", false)
                .putString("timerTitle", title != null ? title : "")
                .putString("customerName", customerName != null ? customerName : "")
                .apply();
            TaktWerkWidgetProvider.updateAllWidgets(context);
        } catch (Exception ignored) {}
    }

    private static void updateWidgetForStop(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(TaktWerkWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                .putBoolean("isRunning", false)
                .putBoolean("isPaused", false)
                .putString("timerTitle", "")
                .putString("customerName", "")
                .apply();
            TaktWerkWidgetProvider.updateAllWidgets(context);
        } catch (Exception ignored) {}
    }

    @SuppressWarnings("deprecation")
    private static void vibratePattern(Context context, String pattern) {
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
                    long[] timings = new long[] { 0, 65, 80, 65 };
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator.vibrate(VibrationEffect.createWaveform(timings, -1));
                    } else {
                        vibrator.vibrate(timings, -1);
                    }
                } else {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator.vibrate(VibrationEffect.createOneShot(85, VibrationEffect.DEFAULT_AMPLITUDE));
                    } else {
                        vibrator.vibrate(85);
                    }
                }
            }
        } catch (Exception ignored) {}
    }
}
