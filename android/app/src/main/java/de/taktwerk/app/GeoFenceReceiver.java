package de.taktwerk.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationManager;

public class GeoFenceReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }
        String action = intent.getAction();

        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            if (GeoFenceEngine.isMonitoringActive(context)
                && GeoFenceEngine.hasBackgroundLocationPermission(context)) {
                GeoFenceEngine.syncMonitoringFromPrefs(context);
            }
            return;
        }

        if (GeoFenceEngine.ACTION_PROXIMITY_ALERT.equals(action)) {
            if (!GeoFenceEngine.isMonitoringActive(context)) {
                return;
            }
            String ruleId = intent.getStringExtra("ruleId");
            boolean entering = intent.getBooleanExtra(LocationManager.KEY_PROXIMITY_ENTERING, true);

            Location loc = GeoFenceEngine.getBestLastKnownLocation(context, 180_000L);
            if (loc == null && entering && ruleId != null) {
                loc = GeoFenceEngine.getRuleFallbackLocation(context, ruleId);
            }
            if (loc != null) {
                GeoFenceEngine.evaluateLocation(context, loc, false);
            }
            // Ensure service is kept alive when background location permission is granted
            if (GeoFenceEngine.hasBackgroundLocationPermission(context)) {
                GeoFenceEngine.startMonitorService(context);
            }
        }
    }
}
