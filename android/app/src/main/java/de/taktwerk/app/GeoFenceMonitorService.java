package de.taktwerk.app;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;

public class GeoFenceMonitorService extends Service {

    private LocationManager locationManager;
    private int currentIntervalSec = -1;
    private boolean listenerRegistered = false;

    private final LocationListener locationListener = new LocationListener() {
        @Override
        public void onLocationChanged(Location location) {
            if (location != null) {
                GeoFenceEngine.evaluateLocation(getApplicationContext(), location, true);
            }
        }

        @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
        @Override public void onProviderEnabled(String provider) {}
        @Override public void onProviderDisabled(String provider) {}
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Context context = getApplicationContext();
        if (!GeoFenceEngine.isMonitoringActive(context)
            || !GeoFenceEngine.hasForegroundLocationPermission(context)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        int ruleCount = GeoFenceEngine.getRuleCount(context);
        int intervalSec = GeoFenceEngine.getMonitorIntervalSec(context);
        Notification notification = GeoFenceEngine.buildMonitorNotification(context, ruleCount, intervalSec);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    GeoFenceEngine.MONITOR_NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                );
            } else {
                startForeground(GeoFenceEngine.MONITOR_NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!listenerRegistered || currentIntervalSec != intervalSec) {
            unregisterUpdates();
            registerUpdates(intervalSec);
        }

        Location recent = GeoFenceEngine.getBestLastKnownLocation(context, 120_000L);
        if (recent != null) {
            GeoFenceEngine.evaluateLocation(context, recent, false);
        }

        return START_STICKY;
    }

    @SuppressLint("MissingPermission")
    private void registerUpdates(int intervalSec) {
        Context context = getApplicationContext();
        if (!GeoFenceEngine.hasForegroundLocationPermission(context)) {
            return;
        }
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) {
            return;
        }

        long minTimeMs = Math.max(20L, (long) intervalSec) * 1000L;
        int registered = 0;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                if (locationManager.isProviderEnabled(LocationManager.FUSED_PROVIDER)) {
                    locationManager.requestLocationUpdates(
                        LocationManager.FUSED_PROVIDER,
                        minTimeMs,
                        0f,
                        locationListener,
                        Looper.getMainLooper()
                    );
                    registered++;
                }
            } catch (Exception ignored) {}
        }

        try {
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    minTimeMs,
                    0f,
                    locationListener,
                    Looper.getMainLooper()
                );
                registered++;
            }
        } catch (Exception ignored) {}

        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    minTimeMs,
                    15f,
                    locationListener,
                    Looper.getMainLooper()
                );
                registered++;
            }
        } catch (Exception ignored) {}

        listenerRegistered = registered > 0;
        currentIntervalSec = intervalSec;
    }

    private void unregisterUpdates() {
        if (locationManager != null && listenerRegistered) {
            try {
                locationManager.removeUpdates(locationListener);
            } catch (Exception ignored) {}
        }
        listenerRegistered = false;
    }

    @Override
    public void onDestroy() {
        unregisterUpdates();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {}
        super.onDestroy();
    }
}
