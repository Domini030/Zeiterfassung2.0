package de.taktwerk.app;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.nfc.FormatException;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.TagLostException;
import android.nfc.tech.Ndef;
import android.nfc.tech.NdefFormatable;
import android.os.Build;
import android.os.Parcelable;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.WebView;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
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
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
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

    private static final String LEGACY_TIMER_CHANNEL_ID = "taktwerk_active_timer";
    private static final String LEGACY_TIMER_CHANNEL_ID_V2 = "taktwerk_active_timer_v2";
    private static final String TIMER_CHANNEL_ID = "taktwerk_active_timer_v3";
    private static final int TIMER_NOTIFICATION_ID = 4102;

    private static final String[] NFC_URI_PREFIXES = new String[] {
        "", "http://www.", "https://www.", "http://", "https://", "tel:", "mailto:",
        "ftp://anonymous:anonymous@", "ftp://ftp.", "ftps://", "sftp://", "smb://",
        "nfs://", "ftp://", "dav://", "news:", "telnet://", "imap:", "rtsp://",
        "urn:", "pop:", "sip:", "sips:", "tftp:", "btspp://", "btl2cap://",
        "btgoep://", "tcpobex://", "irdaobex://", "file://", "urn:epc:id:",
        "urn:epc:tag:", "urn:epc:pat:", "urn:epc:raw:", "urn:epc:", "urn:nfc:"
    };

    private volatile String armedWriteUri = null;
    private volatile String pendingTimerAction = null;
    private boolean foregroundDispatchActive = false;

    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();
    private static final OkHttpClient HTTP_CLIENT = new OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build();

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        enableNfcForegroundDispatch();
    }

    @Override
    protected void handleOnPause() {
        disableNfcForegroundDispatch();
        super.handleOnPause();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
            return;
        }
        String action = intent.getAction();
        if ("de.taktwerk.app.ACTION_TIMER_CONTROL".equals(action)) {
            String timerAction = intent.getStringExtra("timerAction");
            if (timerAction != null && !timerAction.trim().isEmpty()) {
                pendingTimerAction = timerAction.trim();
                JSObject obj = new JSObject();
                obj.put("action", timerAction.trim());
                Activity activity = getActivity();
                if (activity != null) {
                    activity.runOnUiThread(() -> notifyListeners("timerNotificationAction", obj, true));
                }
            }
            return;
        }
        if (NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action)
            || NfcAdapter.ACTION_TECH_DISCOVERED.equals(action)
            || NfcAdapter.ACTION_TAG_DISCOVERED.equals(action)) {
            processNfcIntent(intent);
        }
    }

    private void enableNfcForegroundDispatch() {
        Activity activity = getActivity();
        if (activity == null) {
            return;
        }
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(activity);
        if (adapter == null || !adapter.isEnabled()) {
            foregroundDispatchActive = false;
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Intent nfcIntent = new Intent(activity, activity.getClass());
                nfcIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    flags |= PendingIntent.FLAG_MUTABLE;
                }
                PendingIntent pendingIntent = PendingIntent.getActivity(activity, 0, nfcIntent, flags);
                adapter.enableForegroundDispatch(activity, pendingIntent, null, null);
                foregroundDispatchActive = true;
            } catch (Exception ignored) {
                foregroundDispatchActive = false;
            }
        });
    }

    private void disableNfcForegroundDispatch() {
        Activity activity = getActivity();
        if (activity == null) {
            foregroundDispatchActive = false;
            return;
        }
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(activity);
        if (adapter == null) {
            foregroundDispatchActive = false;
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                adapter.disableForegroundDispatch(activity);
            } catch (Exception ignored) {}
            foregroundDispatchActive = false;
        });
    }

    @SuppressWarnings("deprecation")
    private static Tag extractTagFromIntent(Intent intent) {
        if (intent == null) return null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(NfcAdapter.EXTRA_TAG, Tag.class);
        }
        return intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
    }

    @SuppressWarnings("deprecation")
    private static NdefMessage[] extractNdefMessagesFromIntent(Intent intent) {
        if (intent == null) return null;
        Parcelable[] raw;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            raw = intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES, Parcelable.class);
        } else {
            raw = intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES);
        }
        if (raw == null || raw.length == 0) return null;
        List<NdefMessage> list = new ArrayList<>();
        for (Parcelable p : raw) {
            if (p instanceof NdefMessage) {
                list.add((NdefMessage) p);
            }
        }
        return list.isEmpty() ? null : list.toArray(new NdefMessage[0]);
    }

    private static String bytesToColonHex(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < bytes.length; i++) {
            if (i > 0) sb.append(':');
            sb.append(String.format("%02X", bytes[i] & 0xFF));
        }
        return sb.toString();
    }

    private static List<String> decodeNdefMessages(NdefMessage[] messages) {
        List<String> payloads = new ArrayList<>();
        if (messages == null) return payloads;
        for (NdefMessage msg : messages) {
            if (msg == null) continue;
            for (NdefRecord record : msg.getRecords()) {
                if (record == null) continue;
                short tnf = record.getTnf();
                byte[] type = record.getType();
                byte[] payload = record.getPayload();
                if (payload == null || payload.length == 0) continue;

                if (tnf == NdefRecord.TNF_WELL_KNOWN && Arrays.equals(type, NdefRecord.RTD_URI)) {
                    int prefixIdx = payload[0] & 0xFF;
                    String prefix = prefixIdx < NFC_URI_PREFIXES.length ? NFC_URI_PREFIXES[prefixIdx] : "";
                    String rest = new String(payload, 1, payload.length - 1, StandardCharsets.UTF_8).trim();
                    payloads.add(prefix + rest);
                } else if (tnf == NdefRecord.TNF_WELL_KNOWN && Arrays.equals(type, NdefRecord.RTD_TEXT)) {
                    int statusByte = payload[0] & 0xFF;
                    Charset charset = (statusByte & 0x80) == 0 ? StandardCharsets.UTF_8 : StandardCharsets.UTF_16;
                    int langLen = statusByte & 0x3F;
                    if (1 + langLen <= payload.length) {
                        String txt = new String(payload, 1 + langLen, payload.length - 1 - langLen, charset).trim();
                        if (!txt.isEmpty()) payloads.add(txt);
                    }
                } else if (tnf == NdefRecord.TNF_ABSOLUTE_URI) {
                    String uri = new String(payload, StandardCharsets.UTF_8).trim();
                    if (!uri.isEmpty()) payloads.add(uri);
                } else {
                    Uri parsed = record.toUri();
                    if (parsed != null) {
                        payloads.add(parsed.toString());
                    }
                }
            }
        }
        return payloads;
    }

    private void processNfcIntent(Intent intent) {
        Tag tag = extractTagFromIntent(intent);
        String targetWriteUri = armedWriteUri;

        if (targetWriteUri != null) {
            armedWriteUri = null;
            if (tag == null) {
                emitWriteResult(false, targetWriteUri, "Kein NFC-Tag erkannt. Bitte Tag etwas länger ruhig an die Rückseite halten.");
                return;
            }
            EXECUTOR.execute(() -> performNativeNdefWrite(tag, targetWriteUri));
            return;
        }

        List<String> payloads = new ArrayList<>();
        String dataUri = intent.getDataString();
        if (dataUri != null && !dataUri.trim().isEmpty()) {
            payloads.add(dataUri.trim());
        }

        NdefMessage[] messages = extractNdefMessagesFromIntent(intent);
        if (messages == null && tag != null) {
            Ndef ndef = Ndef.get(tag);
            if (ndef != null) {
                try {
                    NdefMessage cached = ndef.getCachedNdefMessage();
                    if (cached != null) {
                        messages = new NdefMessage[] { cached };
                    }
                } catch (Exception ignored) {}
            }
        }

        for (String decoded : decodeNdefMessages(messages)) {
            if (!payloads.contains(decoded)) {
                payloads.add(decoded);
            }
        }

        String uidHex = tag != null ? bytesToColonHex(tag.getId()) : "";
        if (uidHex.isEmpty() && payloads.isEmpty()) {
            return;
        }

        JSObject event = new JSObject();
        event.put("uidHex", uidHex);
        JSArray payloadArr = new JSArray();
        for (String p : payloads) {
            payloadArr.put(p);
        }
        event.put("payloads", payloadArr);

        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> notifyListeners("nfcTagScanned", event, true));
        }
    }

    private void performNativeNdefWrite(Tag tag, String uri) {
        Ndef ndef = Ndef.get(tag);
        NdefFormatable formatable = null;
        try {
            NdefRecord uriRecord = NdefRecord.createUri(uri);
            NdefRecord aarRecord = NdefRecord.createApplicationRecord(getContext().getPackageName());
            NdefMessage msgWithAar = new NdefMessage(new NdefRecord[] { uriRecord, aarRecord });
            NdefMessage msgUriOnly = new NdefMessage(new NdefRecord[] { uriRecord });

            if (ndef != null) {
                IOException lastIo = null;
                boolean wrote = false;
                for (int attempt = 0; attempt < 2 && !wrote; attempt++) {
                    try {
                        if (!ndef.isConnected()) {
                            ndef.connect();
                        }
                        if (!ndef.isWritable()) {
                            emitWriteResult(false, uri, "Dieser NFC-Tag ist schreibgeschützt (Read-Only) und kann nicht überschrieben werden.");
                            return;
                        }
                        int maxSize = ndef.getMaxSize();
                        NdefMessage chosen = msgWithAar;
                        if (maxSize > 0 && msgWithAar.toByteArray().length > maxSize) {
                            if (msgUriOnly.toByteArray().length <= maxSize) {
                                chosen = msgUriOnly;
                            } else {
                                emitWriteResult(false, uri, "Speicherplatz auf dem Tag reicht nicht aus (" + maxSize + " Bytes verfügbar, " + msgUriOnly.toByteArray().length + " Bytes benötigt).");
                                return;
                            }
                        }
                        ndef.writeNdefMessage(chosen);
                        wrote = true;
                    } catch (TagLostException lostEx) {
                        throw lostEx;
                    } catch (IOException ioEx) {
                        lastIo = ioEx;
                        try { ndef.close(); } catch (Exception ignored) {}
                        if (attempt == 0) {
                            try { Thread.sleep(60); } catch (InterruptedException ignored) {}
                        }
                    }
                }
                if (!wrote) {
                    throw (lastIo != null ? lastIo : new IOException("Schreibvorgang fehlgeschlagen."));
                }
                vibratePattern("start");
                emitWriteResult(true, uri, null);
                return;
            }

            formatable = NdefFormatable.get(tag);
            if (formatable != null) {
                formatable.connect();
                try {
                    formatable.format(msgWithAar);
                } catch (IOException | FormatException aarErr) {
                    formatable.format(msgUriOnly);
                }
                vibratePattern("start");
                emitWriteResult(true, uri, null);
                return;
            }

            emitWriteResult(false, uri, "Dieser NFC-Tag unterstützt kein NDEF-Format.");
        } catch (TagLostException e) {
            vibratePattern("error");
            emitWriteResult(false, uri, "Verbindung zum Tag verloren — bitte den NFC-Tag ca. 1 Sekunde ruhig an der Rückseite halten.");
        } catch (FormatException e) {
            vibratePattern("error");
            emitWriteResult(false, uri, "NFC-Tag-Format wird nicht unterstützt oder ist beschädigt.");
        } catch (Exception e) {
            vibratePattern("error");
            String msg = e.getMessage() != null && !e.getMessage().isEmpty()
                ? e.getMessage()
                : "NFC-Tag konnte nicht beschrieben werden.";
            emitWriteResult(false, uri, msg);
        } finally {
            if (ndef != null) {
                try { if (ndef.isConnected()) ndef.close(); } catch (Exception ignored) {}
            }
            if (formatable != null) {
                try { if (formatable.isConnected()) formatable.close(); } catch (Exception ignored) {}
            }
        }
    }

    private void emitWriteResult(boolean success, String uri, String error) {
        JSObject payload = new JSObject();
        payload.put("success", success);
        payload.put("uri", uri);
        if (error != null) {
            payload.put("error", error);
        }
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> notifyListeners("nfcWriteResult", payload, true));
        }
    }

    @PluginMethod
    public void getNfcStatus(PluginCall call) {
        Activity activity = getActivity();
        NfcAdapter adapter = activity != null ? NfcAdapter.getDefaultAdapter(activity) : NfcAdapter.getDefaultAdapter(getContext());
        boolean supported = adapter != null;
        boolean enabled = adapter != null && adapter.isEnabled();
        String status = !supported ? "NO_NFC" : (enabled ? "NFC_OK" : "NFC_DISABLED");
        if (enabled && !foregroundDispatchActive) {
            enableNfcForegroundDispatch();
        }
        JSObject result = new JSObject();
        result.put("supported", supported);
        result.put("enabled", enabled);
        result.put("status", status);
        call.resolve(result);
    }

    @PluginMethod
    public void openNfcSettings(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Aktivität nicht verfügbar.");
            return;
        }
        try {
            activity.startActivity(new Intent(Settings.ACTION_NFC_SETTINGS));
            call.resolve();
        } catch (ActivityNotFoundException ex) {
            try {
                activity.startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
                call.resolve();
            } catch (ActivityNotFoundException secondary) {
                call.reject("NFC-Einstellungen konnten nicht geöffnet werden.");
            }
        }
    }

    @PluginMethod
    public void armNfcWrite(PluginCall call) {
        String uri = call.getString("uri", "");
        if (uri.trim().isEmpty()) {
            call.reject("Ziel-URI fehlt.");
            return;
        }
        Activity activity = getActivity();
        NfcAdapter adapter = activity != null ? NfcAdapter.getDefaultAdapter(activity) : NfcAdapter.getDefaultAdapter(getContext());
        if (adapter == null) {
            call.reject("Dieses Gerät besitzt keine NFC-Hardware.");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("NFC ist deaktiviert. Bitte aktiviere NFC in den Android-Schnelleinstellungen.");
            return;
        }
        armedWriteUri = uri.trim();
        enableNfcForegroundDispatch();
        call.resolve();
    }

    @PluginMethod
    public void cancelNfcWrite(PluginCall call) {
        armedWriteUri = null;
        call.resolve();
    }

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

    private void vibratePattern(String pattern) {
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
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void hapticFeedback(PluginCall call) {
        String pattern = call.getString("pattern", "start");
        vibratePattern(pattern);
        call.resolve();
    }

    private void ensureTimerChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) {
                return;
            }
            try {
                if (manager.getNotificationChannel(LEGACY_TIMER_CHANNEL_ID) != null) {
                    manager.deleteNotificationChannel(LEGACY_TIMER_CHANNEL_ID);
                }
                if (manager.getNotificationChannel(LEGACY_TIMER_CHANNEL_ID_V2) != null) {
                    manager.deleteNotificationChannel(LEGACY_TIMER_CHANNEL_ID_V2);
                }
            } catch (Exception ignored) {}

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

    private boolean isPostNotificationsGranted(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private JSObject buildNotificationStatusObject(Context context, boolean shown) {
        ensureTimerChannel(context);
        boolean permissionGranted = isPostNotificationsGranted(context);
        boolean systemEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled();
        boolean channelEnabled = true;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                NotificationChannel channel = manager.getNotificationChannel(TIMER_CHANNEL_ID);
                if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) {
                    channelEnabled = false;
                }
            }
        }

        boolean enabled = permissionGranted && systemEnabled && channelEnabled;
        String status;
        if (enabled) {
            status = "OK";
        } else if (!permissionGranted) {
            status = getPermissionState("notifications") == PermissionState.DENIED
                ? "PERMISSION_DENIED"
                : "PERMISSION_REQUIRED";
        } else {
            status = "CHANNEL_DISABLED";
        }

        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("enabled", enabled);
        result.put("permissionGranted", permissionGranted);
        result.put("systemEnabled", systemEnabled);
        result.put("channelEnabled", channelEnabled);
        result.put("status", status);
        result.put("shown", shown);
        return result;
    }

    @PluginMethod
    public void getNotificationStatus(PluginCall call) {
        call.resolve(buildNotificationStatusObject(getContext(), false));
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        Context context = getContext();
        if (isPostNotificationsGranted(context)) {
            call.resolve(buildNotificationStatusObject(context, false));
            return;
        }
        requestPermissionForAlias("notifications", call, "requestNotifPermsCallback");
    }

    @PermissionCallback
    private void requestNotifPermsCallback(PluginCall call) {
        call.resolve(buildNotificationStatusObject(getContext(), false));
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Activity activity = getActivity();
        Context context = getContext();
        if (activity == null) {
            call.reject("Aktivität nicht verfügbar.");
            return;
        }
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.fromParts("package", context.getPackageName(), null));
            }
            activity.startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException ex) {
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.fromParts("package", context.getPackageName(), null));
                activity.startActivity(fallback);
                call.resolve();
            } catch (ActivityNotFoundException secondary) {
                call.reject("App-Benachrichtigungseinstellungen konnten nicht geöffnet werden.");
            }
        }
    }

    @PluginMethod
    public void showActiveTimerNotification(PluginCall call) {
        Context context = getContext();
        if (!isPostNotificationsGranted(context)) {
            if (getPermissionState("notifications") != PermissionState.DENIED) {
                requestPermissionForAlias("notifications", call, "notificationsPermsCallback");
                return;
            }
            call.resolve(buildNotificationStatusObject(context, false));
            return;
        }
        postTimerNotification(call);
    }

    @PermissionCallback
    private void notificationsPermsCallback(PluginCall call) {
        Context context = getContext();
        if (isPostNotificationsGranted(context)) {
            postTimerNotification(call);
        } else {
            call.resolve(buildNotificationStatusObject(context, false));
        }
    }

    @PluginMethod
    public void getPendingTimerAction(PluginCall call) {
        String action = pendingTimerAction;
        pendingTimerAction = null;
        JSObject res = new JSObject();
        res.put("action", action);
        call.resolve(res);
    }

    private void postTimerNotification(PluginCall call) {
        Context context = getContext();
        boolean shown = false;
        try {
            ensureTimerChannel(context);
            JSObject statusBefore = buildNotificationStatusObject(context, false);
            if (!statusBefore.getBoolean("enabled", false)) {
                call.resolve(statusBefore);
                return;
            }

            String title = call.getString("title", "Arbeitszeit");
            String customer = call.getString("customer", "");
            String notes = call.getString("notes", "");
            boolean isPaused = call.getBoolean("isPaused", false);
            String pausedDuration = call.getString("pausedDuration", "");
            long startTimeMs = System.currentTimeMillis();
            Object rawStartObj = call.getData().opt("startTimeMs");
            if (rawStartObj instanceof Number) {
                startTimeMs = ((Number) rawStartObj).longValue();
            }

            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            // Action: Pause / Resume
            Intent pauseResumeIntent = new Intent(context, MainActivity.class);
            pauseResumeIntent.setAction("de.taktwerk.app.ACTION_TIMER_CONTROL");
            pauseResumeIntent.putExtra("timerAction", isPaused ? "resume" : "pause");
            pauseResumeIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pauseResumePendingIntent = PendingIntent.getActivity(
                context,
                101,
                pauseResumeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            // Action: Stop & Save
            Intent stopIntent = new Intent(context, MainActivity.class);
            stopIntent.setAction("de.taktwerk.app.ACTION_TIMER_CONTROL");
            stopIntent.putExtra("timerAction", "stop");
            stopIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent stopPendingIntent = PendingIntent.getActivity(
                context,
                102,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            String contentTitle = isPaused ? "⏸ Timer pausiert: " + title : "⏱ " + title;
            String contentText = isPaused
                ? (customer.isEmpty() ? "Pausiert bei " + pausedDuration : customer + " · Pausiert bei " + pausedDuration)
                : (customer.isEmpty() ? "TaktWerk Zeiterfassung" : customer);

            NotificationCompat.BigTextStyle bigTextStyle = new NotificationCompat.BigTextStyle()
                .setBigContentTitle(contentTitle)
                .bigText(contentText + (notes.isEmpty() ? "" : "\n" + notes))
                .setSummaryText(isPaused ? "Pausiert (" + pausedDuration + ")" : "Zeiterfassung aktiv");

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
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);

            // Add interactive action buttons directly in the notification
            if (isPaused) {
                builder.addAction(
                    R.drawable.ic_action_play,
                    "Fortsetzen",
                    pauseResumePendingIntent
                );
            } else {
                builder.addAction(
                    R.drawable.ic_action_pause,
                    "Pausieren",
                    pauseResumePendingIntent
                );
            }

            builder.addAction(
                R.drawable.ic_action_stop,
                "Stoppen & Speichern",
                stopPendingIntent
            );

            if (!isPaused) {
                builder.setWhen(startTimeMs).setShowWhen(true).setUsesChronometer(true);
            } else {
                builder.setUsesChronometer(false).setShowWhen(false);
            }

            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(TIMER_NOTIFICATION_ID, builder.build());
                shown = true;
            }
        } catch (Exception ignored) {}
        call.resolve(buildNotificationStatusObject(context, shown));
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
