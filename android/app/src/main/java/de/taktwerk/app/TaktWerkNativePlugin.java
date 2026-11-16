package de.taktwerk.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.WebView;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import okhttp3.Credentials;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

@CapacitorPlugin(
    name = "TaktWerkNative",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class TaktWerkNativePlugin extends Plugin {

    private static final String TIMER_CHANNEL_ID = "taktwerk_active_timer";
    private static final int TIMER_NOTIFICATION_ID = 4102;

    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();
    private static final OkHttpClient HTTP_CLIENT = new OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build();

    private void ensureFolders(List<String> folderUrls, String authHeader) throws IOException {
        for (String folderUrl : folderUrls) {
            if (folderUrl == null || folderUrl.trim().isEmpty()) {
                continue;
            }
            Request propReq = new Request.Builder()
                .url(folderUrl)
                .header("Authorization", authHeader)
                .header("Depth", "0")
                .method("PROPFIND", null)
                .build();

            try (Response propRes = HTTP_CLIENT.newCall(propReq).execute()) {
                int code = propRes.code();
                if (code == 401 || code == 403) {
                    throw new IOException("Authentifizierung bei Nextcloud fehlgeschlagen (HTTP " + code + ").");
                }
                if (code == 404) {
                    Request mkcolReq = new Request.Builder()
                        .url(folderUrl)
                        .header("Authorization", authHeader)
                        .method("MKCOL", null)
                        .build();
                    try (Response mkRes = HTTP_CLIENT.newCall(mkcolReq).execute()) {
                        int mkCode = mkRes.code();
                        if (!mkRes.isSuccessful() && mkCode != 405) {
                            throw new IOException("Ordner konnte auf Nextcloud nicht erstellt werden (HTTP " + mkCode + ").");
                        }
                    }
                } else if (!propRes.isSuccessful() && code != 207) {
                    throw new IOException("Nextcloud-Ordnerprüfung fehlgeschlagen (HTTP " + code + ").");
                }
            }
        }
    }

    private List<String> extractFolderUrls(PluginCall call) {
        List<String> list = new ArrayList<>();
        JSArray arr = call.getArray("folderUrls");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                try {
                    String url = arr.getString(i);
                    if (url != null && !url.isEmpty()) {
                        list.add(url);
                    }
                } catch (Exception ignored) {}
            }
        }
        return list;
    }

    @PluginMethod
    public void webdavEnsureFolders(PluginCall call) {
        String username = call.getString("username", "");
        String appPassword = call.getString("appPassword", "");
        List<String> folderUrls = extractFolderUrls(call);

        if (username.isEmpty() || appPassword.isEmpty()) {
            call.reject("Nextcloud-Zugangsdaten fehlen.");
            return;
        }

        String authHeader = Credentials.basic(username, appPassword, StandardCharsets.UTF_8);
        EXECUTOR.execute(() -> {
            try {
                ensureFolders(folderUrls, authHeader);
                JSObject result = new JSObject();
                result.put("ok", true);
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Nextcloud-Ordnerprüfung fehlgeschlagen.");
            }
        });
    }

    @PluginMethod
    public void webdavUploadPdf(PluginCall call) {
        String fileUrl = call.getString("fileUrl", "");
        String username = call.getString("username", "");
        String appPassword = call.getString("appPassword", "");
        String base64 = call.getString("base64", "");
        List<String> folderUrls = extractFolderUrls(call);

        if (fileUrl.isEmpty() || username.isEmpty() || appPassword.isEmpty() || base64.isEmpty()) {
            call.reject("Unvollständige Parameter für PDF-Upload.");
            return;
        }

        String authHeader = Credentials.basic(username, appPassword, StandardCharsets.UTF_8);
        EXECUTOR.execute(() -> {
            try {
                ensureFolders(folderUrls, authHeader);
                byte[] pdfBytes = Base64.decode(base64, Base64.DEFAULT);
                RequestBody body = RequestBody.create(pdfBytes, MediaType.parse("application/pdf"));
                Request putReq = new Request.Builder()
                    .url(fileUrl)
                    .header("Authorization", authHeader)
                    .put(body)
                    .build();

                try (Response res = HTTP_CLIENT.newCall(putReq).execute()) {
                    if (!res.isSuccessful()) {
                        call.reject("Nextcloud PDF-Upload fehlgeschlagen (HTTP " + res.code() + ").");
                        return;
                    }
                    JSObject result = new JSObject();
                    result.put("ok", true);
                    result.put("status", res.code());
                    call.resolve(result);
                }
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Nextcloud PDF-Upload fehlgeschlagen.");
            }
        });
    }

    @PluginMethod
    public void webdavUploadFile(PluginCall call) {
        String fileUrl = call.getString("fileUrl", "");
        String username = call.getString("username", "");
        String appPassword = call.getString("appPassword", "");
        String content = call.getString("content", "");
        String contentType = call.getString("contentType", "application/xml; charset=utf-8");
        List<String> folderUrls = extractFolderUrls(call);

        if (fileUrl.isEmpty() || username.isEmpty() || appPassword.isEmpty() || content.isEmpty()) {
            call.reject("Unvollständige Parameter für Datei-Upload.");
            return;
        }

        String authHeader = Credentials.basic(username, appPassword, StandardCharsets.UTF_8);
        EXECUTOR.execute(() -> {
            try {
                ensureFolders(folderUrls, authHeader);
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
                RequestBody body = RequestBody.create(bytes, MediaType.parse(contentType));
                Request putReq = new Request.Builder()
                    .url(fileUrl)
                    .header("Authorization", authHeader)
                    .put(body)
                    .build();

                try (Response res = HTTP_CLIENT.newCall(putReq).execute()) {
                    if (!res.isSuccessful()) {
                        call.reject("Nextcloud Datei-Upload fehlgeschlagen (HTTP " + res.code() + ").");
                        return;
                    }
                    JSObject result = new JSObject();
                    result.put("ok", true);
                    result.put("status", res.code());
                    call.resolve(result);
                }
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Nextcloud Datei-Upload fehlgeschlagen.");
            }
        });
    }

    @PluginMethod
    public void webdavUploadJson(PluginCall call) {
        String fileUrl = call.getString("fileUrl", "");
        String username = call.getString("username", "");
        String appPassword = call.getString("appPassword", "");
        String json = call.getString("json", "");
        List<String> folderUrls = extractFolderUrls(call);

        if (fileUrl.isEmpty() || username.isEmpty() || appPassword.isEmpty() || json.isEmpty()) {
            call.reject("Unvollständige Parameter für Datenbank-Upload.");
            return;
        }

        String authHeader = Credentials.basic(username, appPassword, StandardCharsets.UTF_8);
        EXECUTOR.execute(() -> {
            try {
                ensureFolders(folderUrls, authHeader);
                byte[] jsonBytes = json.getBytes(StandardCharsets.UTF_8);
                RequestBody body = RequestBody.create(jsonBytes, MediaType.parse("application/json; charset=utf-8"));
                Request putReq = new Request.Builder()
                    .url(fileUrl)
                    .header("Authorization", authHeader)
                    .put(body)
                    .build();

                try (Response res = HTTP_CLIENT.newCall(putReq).execute()) {
                    if (!res.isSuccessful()) {
                        call.reject("Nextcloud-Upload fehlgeschlagen (HTTP " + res.code() + ").");
                        return;
                    }
                    JSObject result = new JSObject();
                    result.put("ok", true);
                    result.put("status", res.code());
                    call.resolve(result);
                }
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Nextcloud-Upload fehlgeschlagen.");
            }
        });
    }

    @PluginMethod
    public void webdavDownloadJson(PluginCall call) {
        String fileUrl = call.getString("fileUrl", "");
        String username = call.getString("username", "");
        String appPassword = call.getString("appPassword", "");

        if (fileUrl.isEmpty() || username.isEmpty() || appPassword.isEmpty()) {
            call.reject("Unvollständige Parameter für Nextcloud-Download.");
            return;
        }

        String authHeader = Credentials.basic(username, appPassword, StandardCharsets.UTF_8);
        EXECUTOR.execute(() -> {
            try {
                Request getReq = new Request.Builder()
                    .url(fileUrl)
                    .header("Authorization", authHeader)
                    .get()
                    .build();

                try (Response res = HTTP_CLIENT.newCall(getReq).execute()) {
                    int code = res.code();
                    if (code == 404) {
                        JSObject result = new JSObject();
                        result.put("found", false);
                        call.resolve(result);
                        return;
                    }
                    if (code == 401 || code == 403) {
                        call.reject("Authentifizierung bei Nextcloud fehlgeschlagen.");
                        return;
                    }
                    if (!res.isSuccessful() || res.body() == null) {
                        call.reject("Laden aus Nextcloud fehlgeschlagen (HTTP " + code + ").");
                        return;
                    }
                    JSObject result = new JSObject();
                    result.put("found", true);
                    result.put("json", res.body().string());
                    call.resolve(result);
                }
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Laden aus Nextcloud fehlgeschlagen.");
            }
        });
    }

    private Uri writeCacheBytesAndGetUri(String filename, byte[] bytes) throws IOException {
        Context context = getContext();
        String safeName = filename.replaceAll("[^a-zA-Z0-9_.-]", "_");
        File outFile = new File(context.getCacheDir(), safeName);
        try (FileOutputStream fos = new FileOutputStream(outFile)) {
            fos.write(bytes);
            fos.flush();
        }
        return FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", outFile);
    }

    @PluginMethod
    public void openPdf(PluginCall call) {
        String filename = call.getString("filename", "Rechnung.pdf");
        String base64 = call.getString("base64", "");
        if (base64.isEmpty()) {
            call.reject("PDF-Daten fehlen.");
            return;
        }

        try {
            String safeName = filename.toLowerCase().endsWith(".pdf") ? filename : filename + ".pdf";
            Uri uri = writeCacheBytesAndGetUri(safeName, Base64.decode(base64, Base64.DEFAULT));
            Intent viewIntent = new Intent(Intent.ACTION_VIEW);
            viewIntent.setDataAndType(uri, "application/pdf");
            viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

            try {
                getActivity().startActivity(Intent.createChooser(viewIntent, "Dokument öffnen"));
                call.resolve();
            } catch (ActivityNotFoundException e) {
                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType("application/pdf");
                shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().startActivity(Intent.createChooser(shareIntent, "Dokument speichern / teilen"));
                call.resolve();
            }
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "PDF konnte auf dem Gerät nicht geöffnet werden.");
        }
    }

    @PluginMethod
    public void sharePdf(PluginCall call) {
        String filename = call.getString("filename", "Rechnung.pdf");
        String base64 = call.getString("base64", "");
        if (base64.isEmpty()) {
            call.reject("PDF-Daten fehlen.");
            return;
        }

        try {
            String safeName = filename.toLowerCase().endsWith(".pdf") ? filename : filename + ".pdf";
            Uri uri = writeCacheBytesAndGetUri(safeName, Base64.decode(base64, Base64.DEFAULT));
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType("application/pdf");
            shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
            shareIntent.putExtra(Intent.EXTRA_SUBJECT, safeName);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(shareIntent, "Dokument teilen / speichern"));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "PDF konnte nicht geteilt werden.");
        }
    }

    @PluginMethod
    public void shareTextFile(PluginCall call) {
        String filename = call.getString("filename", "export.txt");
        String mimeType = call.getString("mimeType", "text/plain");
        String content = call.getString("content", "");
        if (content.isEmpty()) {
            call.reject("Dateiinhalt fehlt.");
            return;
        }

        try {
            Uri uri = writeCacheBytesAndGetUri(filename, content.getBytes(StandardCharsets.UTF_8));
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType(mimeType);
            shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
            shareIntent.putExtra(Intent.EXTRA_SUBJECT, filename);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(shareIntent, "Datei speichern / teilen"));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Datei konnte nicht geteilt werden.");
        }
    }

    @PluginMethod
    public void printWebView(PluginCall call) {
        String jobName = call.getString("jobName", "TaktWerk-Rechnung");
        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = getBridge().getWebView();
                PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                if (printManager == null || webView == null) {
                    call.reject("Druckfunktion auf diesem Gerät nicht verfügbar.");
                    return;
                }
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
                printManager.print(jobName, adapter, new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Drucken fehlgeschlagen.");
            }
        });
    }

    @PluginMethod
    public void hapticFeedback(PluginCall call) {
        String pattern = call.getString("pattern", "start");
        try {
            Context context = getContext();
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
                } else if ("error".equals(pattern)) {
                    long[] timings = new long[] { 0, 45, 55, 45, 55, 45 };
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
            call.resolve();
        } catch (Exception e) {
            call.resolve();
        }
    }

    private void ensureTimerChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null && manager.getNotificationChannel(TIMER_CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                    TIMER_CHANNEL_ID,
                    "Laufende Zeiterfassung",
                    NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Zeigt den aktuell laufenden Timer in der Statusleiste an.");
                channel.setShowBadge(false);
                manager.createNotificationChannel(channel);
            }
        }
    }

    @PluginMethod
    public void showActiveTimerNotification(PluginCall call) {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                if (getPermissionState("notifications") != PermissionState.DENIED) {
                    requestPermissionForAlias("notifications", call, "notificationsPermsCallback");
                    return;
                }
                call.resolve();
                return;
            }
        }
        postTimerNotification(call);
    }

    @PermissionCallback
    private void notificationsPermsCallback(PluginCall call) {
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            postTimerNotification(call);
        } else {
            call.resolve();
        }
    }

    private void postTimerNotification(PluginCall call) {
        try {
            Context context = getContext();
            ensureTimerChannel(context);

            String title = call.getString("title", "Arbeitszeit");
            String customer = call.getString("customer", "");
            boolean isPaused = call.getBoolean("isPaused", false);
            String pausedDuration = call.getString("pausedDuration", "");
            long startTimeMs = call.getLong("startTimeMs", System.currentTimeMillis());

            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            int iconRes = context.getApplicationInfo().icon;
            String contentTitle = isPaused ? "Timer pausiert: " + title : "Timer läuft: " + title;
            String contentText = isPaused
                ? (customer.isEmpty() ? "Pausiert bei " + pausedDuration : customer + " · Pausiert bei " + pausedDuration)
                : (customer.isEmpty() ? "TaktWerk Zeiterfassung aktiv" : customer);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, TIMER_CHANNEL_ID)
                .setSmallIcon(iconRes)
                .setContentTitle(contentTitle)
                .setContentText(contentText)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW);

            if (!isPaused) {
                builder.setWhen(startTimeMs).setShowWhen(true).setUsesChronometer(true);
            } else {
                builder.setUsesChronometer(false).setShowWhen(false);
            }

            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(TIMER_NOTIFICATION_ID, builder.build());
            }
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void clearActiveTimerNotification(PluginCall call) {
        try {
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.cancel(TIMER_NOTIFICATION_ID);
            }
        } catch (Exception ignored) {}
        call.resolve();
    }
}
