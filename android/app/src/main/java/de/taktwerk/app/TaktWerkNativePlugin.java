package de.taktwerk.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
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
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
import androidx.activity.result.ActivityResult;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import okhttp3.Credentials;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "TaktWerkNative",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "backgroundLocation", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION })
    }
)
public class TaktWerkNativePlugin extends Plugin {

    private static final String LEGACY_TIMER_CHANNEL_ID = "taktwerk_active_timer";
    private static final String LEGACY_TIMER_CHANNEL_ID_V2 = "taktwerk_active_timer_v2";
    private static final String TIMER_CHANNEL_ID = "taktwerk_active_timer_v3";
    private static final int TIMER_NOTIFICATION_ID = 4102;
    private static final int REMINDER_ALARM_REQUEST_CODE = 4110;

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
    private volatile String pendingWidgetAction = null;
    private volatile String pendingWidgetTagUid = null;
    private volatile String pendingLaunchNfcUid = null;
    private volatile List<String> pendingLaunchNfcPayloads = null;
    private boolean foregroundDispatchActive = false;
    private volatile Ringtone activePreviewRingtone = null;
    private final Handler previewStopHandler = new Handler(Looper.getMainLooper());
    private volatile long bgLocationRequestStartedMs = 0L;

    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();
    private static final OkHttpClient HTTP_CLIENT = new OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build();

    private static volatile TaktWerkNativePlugin activeInstance = null;

    @Override
    public void load() {
        super.load();
        activeInstance = this;
        GeoFenceEngine.setActivePlugin(this);
        Activity activity = getActivity();
        if (activity != null && activity.getIntent() != null) {
            Intent launchIntent = activity.getIntent();
            handleWidgetUri(launchIntent, false);
            captureLaunchNfcIntent(launchIntent);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        GeoFenceEngine.setActivePlugin(null);
        super.handleOnDestroy();
    }

    public static void dispatchTimerActionFromReceiver(String action, long timestampMs) {
        TaktWerkNativePlugin inst = activeInstance;
        if (inst != null && action != null && !action.trim().isEmpty()) {
            inst.emitTimerNotificationAction(action.trim(), timestampMs);
        }
    }

    public void emitTimerNotificationAction(String action, long timestampMs) {
        Activity activity = getActivity();
        if (activity != null && action != null && !action.trim().isEmpty()) {
            JSObject obj = new JSObject();
            obj.put("action", action.trim());
            obj.put("timestampMs", timestampMs);
            activity.runOnUiThread(() -> notifyListeners("timerNotificationAction", obj, true));
        }
    }

    public void emitGeoFenceEvent(JSObject event) {
        Activity activity = getActivity();
        if (activity != null && event != null) {
            activity.runOnUiThread(() -> notifyListeners("geoFenceEvent", event, true));
        }
    }

    private void captureLaunchNfcIntent(Intent intent) {
        if (intent == null || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
            return;
        }
        String action = intent.getAction();
        if (NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action)
            || NfcAdapter.ACTION_TECH_DISCOVERED.equals(action)
            || NfcAdapter.ACTION_TAG_DISCOVERED.equals(action)) {
            Tag tag = extractTagFromIntent(intent);
            NdefMessage[] msgs = extractNdefMessagesFromIntent(intent);
            List<String> payloads = decodeNdefMessages(msgs);
            Uri dataUri = intent.getData();
            if (dataUri != null && !dataUri.toString().isEmpty()) {
                payloads.add(0, dataUri.toString());
            }
            String uidHex = (tag != null && tag.getId() != null) ? bytesToColonHex(tag.getId()) : "";
            if (!uidHex.isEmpty() || !payloads.isEmpty()) {
                pendingLaunchNfcUid = uidHex;
                pendingLaunchNfcPayloads = payloads;
            }
        }
    }

    @PluginMethod
    public void getPendingLaunchNfc(PluginCall call) {
        JSObject res = new JSObject();
        if (pendingLaunchNfcUid != null) {
            res.put("uidHex", pendingLaunchNfcUid);
        }
        JSArray arr = new JSArray();
        if (pendingLaunchNfcPayloads != null) {
            for (String p : pendingLaunchNfcPayloads) {
                arr.put(p);
            }
        }
        res.put("payloads", arr);
        pendingLaunchNfcUid = null;
        pendingLaunchNfcPayloads = null;
        call.resolve(res);
    }

    private boolean handleWidgetUri(Intent intent, boolean emitNow) {
        if (intent == null) return false;
        Uri data = intent.getData();
        if (data == null || !"taktwerk".equals(data.getScheme()) || !"widget".equals(data.getHost())) {
            return false;
        }
        String path = data.getPath();
        String act = (path != null && path.contains("trigger")) ? "trigger" : "open";
        String tagUid = data.getQueryParameter("tagUid");
        pendingWidgetAction = act;
        pendingWidgetTagUid = tagUid;
        if (emitNow) {
            JSObject obj = new JSObject();
            obj.put("action", act);
            if (tagUid != null) {
                obj.put("tagUid", tagUid);
            }
            Activity activity = getActivity();
            if (activity != null) {
                activity.runOnUiThread(() -> notifyListeners("widgetActionTriggered", obj, true));
            }
        }
        return true;
    }

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
        if (handleWidgetUri(intent, true)) {
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

    @PluginMethod
    public void webdavDeleteFiles(PluginCall call) {
        JSArray fileUrls = call.getArray("fileUrls");
        String username = call.getString("username", "");
        String appPassword = call.getString("appPassword", "");

        if (fileUrls == null || username.isEmpty() || appPassword.isEmpty()) {
            JSObject result = new JSObject();
            result.put("deletedCount", 0);
            call.resolve(result);
            return;
        }

        String authHeader = Credentials.basic(username, appPassword, StandardCharsets.UTF_8);
        EXECUTOR.execute(() -> {
            int deletedCount = 0;
            try {
                for (int i = 0; i < fileUrls.length(); i++) {
                    String targetUrl = fileUrls.optString(i, "");
                    if (targetUrl.isEmpty()) continue;

                    Request delReq = new Request.Builder()
                        .url(targetUrl)
                        .header("Authorization", authHeader)
                        .delete()
                        .build();

                    try (Response res = HTTP_CLIENT.newCall(delReq).execute()) {
                        int code = res.code();
                        if (res.isSuccessful() || code == 204) {
                            deletedCount++;
                        } else if (code == 401 || code == 403) {
                            call.reject("Authentifizierung bei Nextcloud fehlgeschlagen.");
                            return;
                        } else if (code != 404) {
                            call.reject("Löschen auf Nextcloud fehlgeschlagen (HTTP " + code + ").");
                            return;
                        }
                    }
                }
                JSObject result = new JSObject();
                result.put("deletedCount", deletedCount);
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Löschen auf Nextcloud fehlgeschlagen.");
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

    @PluginMethod
    public void consumePendingTimerActions(PluginCall call) {
        JSArray out = new JSArray();
        try {
            JSONArray queued = TimerNotificationActionReceiver.consumePendingActions(getContext());
            for (int i = 0; i < queued.length(); i++) {
                JSONObject item = queued.optJSONObject(i);
                if (item != null) {
                    JSObject jsItem = new JSObject();
                    jsItem.put("id", item.optString("id", ""));
                    jsItem.put("action", item.optString("action", ""));
                    jsItem.put("timestampMs", item.optLong("timestampMs", System.currentTimeMillis()));
                    out.put(jsItem);
                }
            }
            if (pendingTimerAction != null && !pendingTimerAction.trim().isEmpty()) {
                JSObject legacy = new JSObject();
                legacy.put("id", "legacy-" + System.currentTimeMillis());
                legacy.put("action", pendingTimerAction.trim());
                legacy.put("timestampMs", System.currentTimeMillis());
                out.put(legacy);
                pendingTimerAction = null;
            }
        } catch (Exception ignored) {}
        JSObject res = new JSObject();
        res.put("actions", out);
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
            boolean lockscreenControls = call.getBoolean("lockscreenControls", true);
            long startTimeMs = System.currentTimeMillis();
            Object rawStartObj = call.getData().opt("startTimeMs");
            if (rawStartObj instanceof Number) {
                startTimeMs = ((Number) rawStartObj).longValue();
            }
            long elapsedMs = Math.max(0L, System.currentTimeMillis() - startTimeMs);
            Object rawElapsedObj = call.getData().opt("elapsedMs");
            if (rawElapsedObj instanceof Number) {
                elapsedMs = Math.max(0L, ((Number) rawElapsedObj).longValue());
            }

            TimerNotificationActionReceiver.saveTimerSnapshot(
                context,
                title,
                customer,
                notes,
                startTimeMs,
                elapsedMs,
                isPaused,
                pausedDuration,
                lockscreenControls
            );

            shown = TimerNotificationActionReceiver.postTimerNotification(
                context,
                title,
                customer,
                notes,
                startTimeMs,
                isPaused,
                pausedDuration,
                lockscreenControls
            );
        } catch (Exception ignored) {}
        call.resolve(buildNotificationStatusObject(context, shown));
    }

    @PluginMethod
    public void clearActiveTimerNotification(PluginCall call) {
        try {
            TimerNotificationActionReceiver.clearTimerSnapshot(getContext());
            NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.cancel(TIMER_NOTIFICATION_ID);
            }
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void webdavUploadBinary(PluginCall call) {
        String fileUrl = call.getString("fileUrl", "");
        String username = call.getString("username", "");
        String appPassword = call.getString("appPassword", "");
        String contentType = call.getString("contentType", "application/octet-stream");
        String base64 = call.getString("base64", "");
        List<String> folderUrls = extractFolderUrls(call);

        if (fileUrl.isEmpty() || username.isEmpty() || appPassword.isEmpty() || base64.isEmpty()) {
            call.reject("Unvollständige Parameter für Binär-Upload.");
            return;
        }

        String authHeader = Credentials.basic(username, appPassword, StandardCharsets.UTF_8);
        EXECUTOR.execute(() -> {
            try {
                ensureFolders(folderUrls, authHeader);
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                RequestBody body = RequestBody.create(bytes, MediaType.parse(contentType));
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
    public void caldavRequest(PluginCall call) {
        String method = call.getString("method", "PROPFIND");
        String url = call.getString("url", "");
        String username = call.getString("username", "");
        String appPassword = call.getString("appPassword", "");
        String depth = call.getString("depth", "");
        String contentType = call.getString("contentType", "application/xml; charset=utf-8");
        String bodyStr = call.getString("body", "");

        if (url.isEmpty() || username.isEmpty() || appPassword.isEmpty()) {
            call.reject("Unvollständige CalDAV-Parameter.");
            return;
        }

        String authHeader = Credentials.basic(username, appPassword, StandardCharsets.UTF_8);
        EXECUTOR.execute(() -> {
            try {
                Request.Builder builder = new Request.Builder()
                    .url(url)
                    .header("Authorization", authHeader);
                if (depth != null && !depth.isEmpty()) {
                    builder.header("Depth", depth);
                }
                RequestBody reqBody = null;
                if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method) && !"DELETE".equalsIgnoreCase(method)) {
                    byte[] bytes = bodyStr != null ? bodyStr.getBytes(StandardCharsets.UTF_8) : new byte[0];
                    reqBody = RequestBody.create(bytes, MediaType.parse(contentType));
                }
                builder.method(method.toUpperCase(), reqBody);

                try (Response res = HTTP_CLIENT.newCall(builder.build()).execute()) {
                    String resBody = res.body() != null ? res.body().string() : "";
                    JSObject result = new JSObject();
                    result.put("status", res.code());
                    result.put("body", resBody);
                    call.resolve(result);
                }
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "CalDAV-Anfrage fehlgeschlagen.");
            }
        });
    }

    @PluginMethod
    public void shareBinaryFile(PluginCall call) {
        String filename = call.getString("filename", "export.bin");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String base64 = call.getString("base64", "");
        if (base64.isEmpty()) {
            call.reject("Dateidaten fehlen.");
            return;
        }

        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            Uri uri = writeCacheBytesAndGetUri(filename, bytes);
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

    private boolean hasLocationPermission(Context context) {
        return GeoFenceEngine.hasForegroundLocationPermission(context);
    }

    private JSObject buildLocationPermissionStatus(Context context, boolean openedSettings) {
        boolean foregroundGranted = GeoFenceEngine.hasForegroundLocationPermission(context);
        boolean fineGranted = GeoFenceEngine.hasFineLocationPermission(context);
        boolean backgroundGranted = GeoFenceEngine.hasBackgroundLocationPermission(context);
        boolean gpsEnabled = GeoFenceEngine.isGpsEnabled(context);
        boolean batteryIgnored = GeoFenceEngine.isBatteryOptimizationIgnored(context);
        boolean serviceRunning = GeoFenceEngine.isMonitorServiceRunning(context);

        String status;
        if (!foregroundGranted) {
            status = "FOREGROUND_REQUIRED";
        } else if (!backgroundGranted) {
            status = "BACKGROUND_REQUIRED";
        } else if (!gpsEnabled) {
            status = "GPS_DISABLED";
        } else {
            status = "OK";
        }

        JSObject res = new JSObject();
        res.put("supported", true);
        res.put("foregroundGranted", foregroundGranted);
        res.put("fineGranted", fineGranted);
        res.put("backgroundGranted", backgroundGranted);
        res.put("gpsEnabled", gpsEnabled);
        res.put("batteryOptimizationIgnored", batteryIgnored);
        res.put("serviceRunning", serviceRunning);
        res.put("openedSettings", openedSettings);
        res.put("status", status);
        return res;
    }

    @PluginMethod
    public void getLocationPermissionStatus(PluginCall call) {
        call.resolve(buildLocationPermissionStatus(getContext(), false));
    }

    @PluginMethod
    public void requestBackgroundLocationPermission(PluginCall call) {
        Context context = getContext();
        if (!GeoFenceEngine.hasForegroundLocationPermission(context)) {
            requestPermissionForAlias("location", call, "fgThenBgLocationCallback");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !GeoFenceEngine.hasBackgroundLocationPermission(context)) {
            bgLocationRequestStartedMs = System.currentTimeMillis();
            requestPermissionForAlias("backgroundLocation", call, "bgLocationPermsCallback");
            return;
        }
        GeoFenceEngine.syncMonitoringFromPrefs(context);
        call.resolve(buildLocationPermissionStatus(context, false));
    }

    @PermissionCallback
    private void fgThenBgLocationCallback(PluginCall call) {
        Context context = getContext();
        if (!GeoFenceEngine.hasForegroundLocationPermission(context)) {
            call.resolve(buildLocationPermissionStatus(context, false));
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !GeoFenceEngine.hasBackgroundLocationPermission(context)) {
            bgLocationRequestStartedMs = System.currentTimeMillis();
            requestPermissionForAlias("backgroundLocation", call, "bgLocationPermsCallback");
            return;
        }
        GeoFenceEngine.syncMonitoringFromPrefs(context);
        call.resolve(buildLocationPermissionStatus(context, false));
    }

    @PermissionCallback
    private void bgLocationPermsCallback(PluginCall call) {
        Context context = getContext();
        boolean bgGranted = GeoFenceEngine.hasBackgroundLocationPermission(context);
        boolean openedSettings = false;
        if (bgGranted) {
            GeoFenceEngine.syncMonitoringFromPrefs(context);
        } else {
            long elapsed = System.currentTimeMillis() - bgLocationRequestStartedMs;
            // On Android 11+, if user previously chose "Only while using" or declined twice,
            // Android suppresses the system permission redirect (<450ms). Open App Details directly.
            if (elapsed < 450L) {
                openedSettings = openAppDetailsSettings(context);
            }
        }
        call.resolve(buildLocationPermissionStatus(context, openedSettings));
    }

    private boolean openAppDetailsSettings(Context context) {
        Activity activity = getActivity();
        if (activity == null || context == null) return false;
        try {
            Intent intent = new Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", context.getPackageName(), null)
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    @PluginMethod
    public void openLocationPermissionSettings(PluginCall call) {
        if (openAppDetailsSettings(getContext())) {
            call.resolve();
        } else {
            call.reject("App-Berechtigungseinstellungen konnten nicht geöffnet werden.");
        }
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Activity activity = getActivity();
        Context context = getContext();
        if (activity == null) {
            call.reject("Aktivität nicht verfügbar.");
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
                call.resolve();
                return;
            }
        } catch (Exception ignored) {}
        if (openAppDetailsSettings(context)) {
            call.resolve();
        } else {
            call.reject("Akku-Einstellungen konnten nicht geöffnet werden.");
        }
    }

    @PluginMethod
    public void syncGeoFenceMonitoring(PluginCall call) {
        Context context = getContext();
        boolean enabled = call.getBoolean("enabled", false);
        int intervalSec = call.getInt("intervalSec", 60);
        String exitConfirmMode = call.getString("exitConfirmMode", "ask");
        boolean hasActiveTimer = call.getBoolean("hasActiveTimer", false);
        String activeGeoRuleId = call.getString("activeGeoRuleId", "");
        String soundPreset = call.getString("soundPreset", "chime");
        String systemSoundUri = call.getString("systemSoundUri", "");
        String rulesJson = call.getString("rulesJson", "[]");

        GeoFenceEngine.saveConfig(
            context,
            enabled,
            intervalSec,
            exitConfirmMode,
            hasActiveTimer,
            activeGeoRuleId,
            soundPreset,
            systemSoundUri,
            rulesJson
        );
        GeoFenceEngine.syncMonitoringFromPrefs(context);
        call.resolve(buildLocationPermissionStatus(context, false));
    }

    @PluginMethod
    public void consumePendingGeoEvents(PluginCall call) {
        Context context = getContext();
        org.json.JSONArray arr = GeoFenceEngine.consumePendingEvents(context);
        JSArray out = new JSArray();
        for (int i = 0; i < arr.length(); i++) {
            org.json.JSONObject obj = arr.optJSONObject(i);
            if (obj != null) {
                try {
                    out.put(JSObject.fromJSONObject(obj));
                } catch (Exception ignored) {}
            }
        }
        JSObject res = new JSObject();
        res.put("events", out);
        call.resolve(res);
    }

    @PluginMethod
    public void getCurrentLocation(PluginCall call) {
        Context context = getContext();
        if (!hasLocationPermission(context)) {
            requestPermissionForAlias("location", call, "locationPermsCallback");
            return;
        }
        resolveNativeLocation(call);
    }

    @PermissionCallback
    private void locationPermsCallback(PluginCall call) {
        if (hasLocationPermission(getContext())) {
            resolveNativeLocation(call);
        } else {
            call.reject("Standortberechtigung wurde nicht erteilt.");
        }
    }

    @SuppressWarnings("MissingPermission")
    private void resolveNativeLocation(PluginCall call) {
        Activity activity = getActivity();
        Context context = getContext();
        if (activity == null) {
            call.reject("Aktivität nicht verfügbar.");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
                if (lm == null) {
                    call.reject("Standortdienst auf diesem Gerät nicht verfügbar.");
                    return;
                }
                Location bestLast = null;
                long now = System.currentTimeMillis();
                for (String provider : lm.getProviders(true)) {
                    try {
                        Location l = lm.getLastKnownLocation(provider);
                        if (l != null) {
                            if (bestLast == null) {
                                bestLast = l;
                            } else {
                                long lAge = Math.max(0L, now - l.getTime());
                                long bAge = Math.max(0L, now - bestLast.getTime());
                                boolean lMuchNewer = lAge + 120_000L < bAge;
                                boolean bMuchNewer = bAge + 120_000L < lAge;
                                if (lMuchNewer || (!bMuchNewer && l.getAccuracy() < bestLast.getAccuracy())) {
                                    bestLast = l;
                                }
                            }
                        }
                    } catch (Exception ignored) {}
                }

                // Use recent cached fix immediately (up to 5 min if reasonably accurate)
                if (bestLast != null && (now - bestLast.getTime()) < 300_000L && bestLast.getAccuracy() <= 150f) {
                    JSObject res = new JSObject();
                    res.put("lat", bestLast.getLatitude());
                    res.put("lng", bestLast.getLongitude());
                    res.put("accuracyMeters", Math.round(bestLast.getAccuracy()));
                    call.resolve(res);
                    return;
                }

                // Collect all available active providers (Fused + GPS + Network) so indoor cold-start NFC works fast!
                List<String> activeProviders = new ArrayList<>();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    try {
                        if (lm.isProviderEnabled(LocationManager.FUSED_PROVIDER)) {
                            activeProviders.add(LocationManager.FUSED_PROVIDER);
                        }
                    } catch (Exception ignored) {}
                }
                try {
                    if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                        activeProviders.add(LocationManager.NETWORK_PROVIDER);
                    }
                } catch (Exception ignored) {}
                try {
                    if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                        activeProviders.add(LocationManager.GPS_PROVIDER);
                    }
                } catch (Exception ignored) {}

                if (activeProviders.isEmpty()) {
                    if (bestLast != null) {
                        JSObject res = new JSObject();
                        res.put("lat", bestLast.getLatitude());
                        res.put("lng", bestLast.getLongitude());
                        res.put("accuracyMeters", Math.round(bestLast.getAccuracy()));
                        call.resolve(res);
                    } else {
                        call.reject("Bitte aktiviere GPS / Standort in den Android-Einstellungen.");
                    }
                    return;
                }

                final boolean[] settled = new boolean[] { false };
                final Handler timeoutHandler = new Handler(Looper.getMainLooper());
                final Location fallbackLocation = bestLast;

                final LocationListener listener = new LocationListener() {
                    @Override
                    public void onLocationChanged(Location loc) {
                        if (settled[0] || loc == null) return;
                        settled[0] = true;
                        timeoutHandler.removeCallbacksAndMessages(null);
                        try { lm.removeUpdates(this); } catch (Exception ignored) {}
                        JSObject res = new JSObject();
                        res.put("lat", loc.getLatitude());
                        res.put("lng", loc.getLongitude());
                        res.put("accuracyMeters", Math.round(loc.getAccuracy()));
                        call.resolve(res);
                    }
                    @Override public void onStatusChanged(String p, int status, Bundle extras) {}
                    @Override public void onProviderEnabled(String p) {}
                    @Override public void onProviderDisabled(String p) {}
                };

                int registered = 0;
                for (String p : activeProviders) {
                    try {
                        lm.requestLocationUpdates(p, 0L, 0f, listener, Looper.getMainLooper());
                        registered++;
                    } catch (Exception ignored) {}
                }

                if (registered == 0) {
                    if (fallbackLocation != null) {
                        JSObject res = new JSObject();
                        res.put("lat", fallbackLocation.getLatitude());
                        res.put("lng", fallbackLocation.getLongitude());
                        res.put("accuracyMeters", Math.round(fallbackLocation.getAccuracy()));
                        call.resolve(res);
                    } else {
                        call.reject("Standortdienst konnte nicht gestartet werden.");
                    }
                    return;
                }

                timeoutHandler.postDelayed(() -> {
                    if (settled[0]) return;
                    settled[0] = true;
                    try { lm.removeUpdates(listener); } catch (Exception ignored) {}
                    if (fallbackLocation != null) {
                        JSObject res = new JSObject();
                        res.put("lat", fallbackLocation.getLatitude());
                        res.put("lng", fallbackLocation.getLongitude());
                        res.put("accuracyMeters", Math.round(fallbackLocation.getAccuracy()));
                        call.resolve(res);
                    } else {
                        call.reject("Standort-Timeout (kein GPS- oder Netzwerksignal gefunden).");
                    }
                }, 12_000L);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Standort konnte nicht ermittelt werden.");
            }
        });
    }

    @PluginMethod
    public void scheduleTimerReminder(PluginCall call) {
        Context context = getContext();
        long delayMs = 3_600_000L;
        Object rawDelay = call.getData().opt("delayMs");
        if (rawDelay instanceof Number) {
            delayMs = Math.max(5_000L, ((Number) rawDelay).longValue());
        }
        String title = call.getString("title", "TaktWerk Erinnerung");
        String body = call.getString("body", "Deine Aufgabe läuft bereits seit längerer Zeit.");
        String soundPreset = call.getString("soundPreset", "chime");
        String systemSoundUri = call.getString("systemSoundUri", "");

        try {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager != null) {
                Intent intent = new Intent(context, TimerReminderReceiver.class);
                intent.putExtra("title", title);
                intent.putExtra("body", body);
                intent.putExtra("soundPreset", soundPreset);
                if (systemSoundUri != null && !systemSoundUri.trim().isEmpty()) {
                    intent.putExtra("systemSoundUri", systemSoundUri.trim());
                }
                PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    context,
                    REMINDER_ALARM_REQUEST_CODE,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                long triggerAt = System.currentTimeMillis() + delayMs;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
                } else {
                    alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
                }
            }
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void cancelTimerReminder(PluginCall call) {
        Context context = getContext();
        try {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager != null) {
                Intent intent = new Intent(context, TimerReminderReceiver.class);
                PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    context,
                    REMINDER_ALARM_REQUEST_CODE,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                alarmManager.cancel(pendingIntent);
            }
        } catch (Exception ignored) {}
        call.resolve();
    }

    private void stopPreviewSound() {
        previewStopHandler.removeCallbacksAndMessages(null);
        Ringtone current = activePreviewRingtone;
        activePreviewRingtone = null;
        if (current != null) {
            try {
                if (current.isPlaying()) {
                    current.stop();
                }
            } catch (Exception ignored) {}
        }
        ReminderToneSynth.stopCurrent();
    }

    @PluginMethod
    public void playReminderTone(PluginCall call) {
        String preset = call.getString("preset", "chime");
        String systemSoundUri = call.getString("systemSoundUri", "");
        stopPreviewSound();

        if ("silent".equals(preset)) {
            vibratePattern("start");
            call.resolve();
            return;
        }

        Context context = getContext();
        boolean useDeviceUri = "device".equals(preset)
            || (systemSoundUri != null && !systemSoundUri.trim().isEmpty());

        if (useDeviceUri) {
            EXECUTOR.execute(() -> {
                try {
                    Uri targetUri = null;
                    if (systemSoundUri != null && !systemSoundUri.trim().isEmpty()) {
                        try {
                            targetUri = Uri.parse(systemSoundUri.trim());
                        } catch (Exception ignored) {}
                    }
                    if (targetUri == null) {
                        targetUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                    }
                    Ringtone r = targetUri != null ? RingtoneManager.getRingtone(context, targetUri) : null;
                    if (r != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            r.setAudioAttributes(
                                new AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                    .build()
                            );
                        }
                        activePreviewRingtone = r;
                        r.play();
                        previewStopHandler.postDelayed(() -> {
                            if (activePreviewRingtone == r) {
                                try {
                                    if (r.isPlaying()) r.stop();
                                } catch (Exception ignored) {}
                                activePreviewRingtone = null;
                            }
                        }, 3600L);
                    }
                } catch (Exception ignored) {}
            });
            call.resolve();
            return;
        }

        ReminderToneSynth.playPresetAsync(context, preset, false);
        call.resolve();
    }

    @PluginMethod
    public void pickSystemNotificationSound(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Aktivität nicht verfügbar.");
            return;
        }

        stopPreviewSound();

        String ringtoneType = call.getString("ringtoneType", "notification");
        String existingUriStr = call.getString("existingUri", "");

        int managerType = RingtoneManager.TYPE_NOTIFICATION;
        String pickerTitle = "Pixel- / Benachrichtigungston wählen";
        if ("alarm".equals(ringtoneType)) {
            managerType = RingtoneManager.TYPE_ALARM;
            pickerTitle = "Pixel- / Weckerton wählen";
        } else if ("all".equals(ringtoneType)) {
            managerType = RingtoneManager.TYPE_ALL;
            pickerTitle = "Smartphone-Ton wählen";
        }

        Uri defaultUri = RingtoneManager.getDefaultUri(
            "alarm".equals(ringtoneType) ? RingtoneManager.TYPE_ALARM : RingtoneManager.TYPE_NOTIFICATION
        );
        Uri existingUri = defaultUri;
        if (existingUriStr != null && !existingUriStr.trim().isEmpty()) {
            try {
                existingUri = Uri.parse(existingUriStr.trim());
            } catch (Exception ignored) {}
        }

        Intent intent = new Intent(RingtoneManager.ACTION_RINGTONE_PICKER);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, managerType);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, pickerTitle);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false);
        if (defaultUri != null) {
            intent.putExtra(RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI, defaultUri);
        }
        if (existingUri != null) {
            intent.putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, existingUri);
        }

        try {
            startActivityForResult(call, intent, "ringtonePickerResult");
        } catch (Exception e) {
            call.reject("System-Tonauswahl konnte auf diesem Gerät nicht geöffnet werden.");
        }
    }

    @SuppressWarnings("deprecation")
    @ActivityCallback
    private void ringtonePickerResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject cancelledRes = new JSObject();
            cancelledRes.put("cancelled", true);
            call.resolve(cancelledRes);
            return;
        }

        Intent data = result.getData();
        Uri pickedUri;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pickedUri = data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI, Uri.class);
        } else {
            pickedUri = data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI);
        }

        if (pickedUri == null) {
            JSObject cancelledRes = new JSObject();
            cancelledRes.put("cancelled", true);
            call.resolve(cancelledRes);
            return;
        }

        Context context = getContext();
        String title = "Smartphone-Systemton";
        try {
            Ringtone r = RingtoneManager.getRingtone(context, pickedUri);
            if (r != null) {
                String resolvedTitle = r.getTitle(context);
                if (resolvedTitle != null && !resolvedTitle.trim().isEmpty()) {
                    title = resolvedTitle.trim();
                }
            }
        } catch (Exception ignored) {}

        JSObject res = new JSObject();
        res.put("cancelled", false);
        res.put("uri", pickedUri.toString());
        res.put("title", title);
        call.resolve(res);
    }

    @PluginMethod
    public void listSystemNotificationSounds(PluginCall call) {
        String ringtoneType = call.getString("ringtoneType", "notification");
        int managerType = "alarm".equals(ringtoneType)
            ? RingtoneManager.TYPE_ALARM
            : RingtoneManager.TYPE_NOTIFICATION;

        Context context = getContext();
        EXECUTOR.execute(() -> {
            JSArray sounds = new JSArray();
            Set<String> seenUris = new HashSet<>();
            Cursor cursor = null;
            try {
                Uri defaultUri = RingtoneManager.getDefaultUri(managerType);
                if (defaultUri != null) {
                    String defTitle = "Standard-Benachrichtigungston";
                    try {
                        Ringtone defR = RingtoneManager.getRingtone(context, defaultUri);
                        if (defR != null) {
                            String resolved = defR.getTitle(context);
                            if (resolved != null && !resolved.trim().isEmpty()) {
                                defTitle = resolved.trim() + " (Standard)";
                            }
                        }
                    } catch (Exception ignored) {}
                    JSObject defItem = new JSObject();
                    defItem.put("uri", defaultUri.toString());
                    defItem.put("title", defTitle);
                    sounds.put(defItem);
                    seenUris.add(defaultUri.toString());
                }

                RingtoneManager rm = new RingtoneManager(context);
                rm.setType(managerType);
                cursor = rm.getCursor();
                if (cursor != null) {
                    int count = 0;
                    while (cursor.moveToNext() && count < 120) {
                        int pos = cursor.getPosition();
                        String title = cursor.getString(RingtoneManager.TITLE_COLUMN_INDEX);
                        Uri uri = rm.getRingtoneUri(pos);
                        if (uri != null && title != null && !title.trim().isEmpty()) {
                            String uriStr = uri.toString();
                            if (seenUris.add(uriStr)) {
                                JSObject item = new JSObject();
                                item.put("uri", uriStr);
                                item.put("title", title.trim());
                                sounds.put(item);
                                count++;
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
                // Return whatever system sounds could be collected
            } finally {
                if (cursor != null) {
                    try { cursor.close(); } catch (Exception ignored) {}
                }
            }

            JSObject res = new JSObject();
            res.put("sounds", sounds);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void updateWidgetState(PluginCall call) {
        Context context = getContext();
        try {
            SharedPreferences prefs = context.getSharedPreferences(TaktWerkWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor ed = prefs.edit();
            ed.putBoolean("isRunning", call.getBoolean("isRunning", false));
            ed.putBoolean("isPaused", call.getBoolean("isPaused", false));
            ed.putString("timerTitle", call.getString("timerTitle", ""));
            ed.putString("customerName", call.getString("customerName", ""));
            ed.putString("todayHoursLabel", call.getString("todayHoursLabel", "0,0 Std."));
            ed.putString("quickTasksJson", call.getString("quickTasksJson", "[]"));
            ed.apply();
            TaktWerkWidgetProvider.updateAllWidgets(context);
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void getPendingWidgetAction(PluginCall call) {
        String act = pendingWidgetAction;
        String uid = pendingWidgetTagUid;
        pendingWidgetAction = null;
        pendingWidgetTagUid = null;
        JSObject res = new JSObject();
        res.put("action", act);
        res.put("tagUid", uid);
        call.resolve(res);
    }

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        Context context = getContext();
        JSObject res = new JSObject();
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            res.put("versionName", info.versionName != null ? info.versionName : "1.1.0");
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;
            res.put("versionCode", code);
        } catch (Exception e) {
            res.put("versionName", "1.1.0");
            res.put("versionCode", 1);
        }
        call.resolve(res);
    }

    @PluginMethod
    public void downloadAndInstallApk(PluginCall call) {
        String url = call.getString("url", "");
        String filename = call.getString("filename", "TaktWerk-Update.apk");
        Activity activity = getActivity();
        Context context = getContext();

        if (url == null || url.trim().isEmpty()) {
            call.reject("Download-URL für das Update fehlt.");
            return;
        }
        if (activity == null) {
            call.reject("Aktivität nicht verfügbar.");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!context.getPackageManager().canRequestPackageInstalls()) {
                try {
                    Intent permIntent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + context.getPackageName())
                    );
                    permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(permIntent);
                } catch (Exception ignored) {}
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("needsPermission", true);
                res.put("message", "Bitte erlaube „Aus dieser Quelle zulassen“ in den Android-Einstellungen und tippe danach erneut auf Update installieren.");
                call.resolve(res);
                return;
            }
        }

        EXECUTOR.execute(() -> {
            try {
                Request req = new Request.Builder()
                    .url(url.trim())
                    .header("User-Agent", "TaktWerk-Android-Updater")
                    .build();

                try (Response response = HTTP_CLIENT.newCall(req).execute()) {
                    if (!response.isSuccessful() || response.body() == null) {
                        call.reject("APK-Download fehlgeschlagen (HTTP " + response.code() + ").");
                        return;
                    }

                    String safeName = filename.replaceAll("[^a-zA-Z0-9._-]", "_");
                    if (!safeName.toLowerCase().endsWith(".apk")) {
                        safeName = safeName + ".apk";
                    }
                    File outDir = new File(context.getCacheDir(), "exports");
                    if (!outDir.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        outDir.mkdirs();
                    }
                    File apkFile = new File(outDir, safeName);
                    try (InputStream in = response.body().byteStream();
                         FileOutputStream out = new FileOutputStream(apkFile)) {
                        byte[] buf = new byte[16384];
                        int len;
                        while ((len = in.read(buf)) != -1) {
                            out.write(buf, 0, len);
                        }
                        out.flush();
                    }

                    Uri apkUri = FileProvider.getUriForFile(
                        context,
                        context.getPackageName() + ".fileprovider",
                        apkFile
                    );

                    activity.runOnUiThread(() -> {
                        try {
                            Intent installIntent = new Intent(Intent.ACTION_VIEW);
                            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                            activity.startActivity(installIntent);
                            JSObject okRes = new JSObject();
                            okRes.put("ok", true);
                            okRes.put("needsPermission", false);
                            okRes.put("message", "Update heruntergeladen – Android-Installationsdialog geöffnet.");
                            call.resolve(okRes);
                        } catch (Exception e) {
                            call.reject(e.getMessage() != null ? e.getMessage() : "Installationsdialog konnte nicht geöffnet werden.");
                        }
                    });
                }
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "APK-Download fehlgeschlagen.");
            }
        });
    }

    @PluginMethod
    public void sharePdfWithEmail(PluginCall call) {
        String filename = call.getString("filename", "Rechnung.pdf");
        String base64 = call.getString("base64", "");
        String to = call.getString("to", "");
        String subject = call.getString("subject", "TaktWerk Dokument");
        String body = call.getString("body", "");

        if (base64.isEmpty()) {
            call.reject("PDF-Daten fehlen.");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Aktivität nicht verfügbar.");
            return;
        }

        try {
            String safeName = filename.toLowerCase().endsWith(".pdf") ? filename : filename + ".pdf";
            Uri uri = writeCacheBytesAndGetUri(safeName, Base64.decode(base64, Base64.DEFAULT));

            Intent emailIntent = new Intent(Intent.ACTION_SEND);
            emailIntent.setType("application/pdf");
            if (to != null && !to.trim().isEmpty()) {
                emailIntent.putExtra(Intent.EXTRA_EMAIL, new String[] { to.trim() });
            }
            emailIntent.putExtra(Intent.EXTRA_SUBJECT, subject);
            emailIntent.putExtra(Intent.EXTRA_TEXT, body);
            emailIntent.putExtra(Intent.EXTRA_STREAM, uri);
            emailIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            activity.startActivity(Intent.createChooser(emailIntent, "Dokument per E-Mail senden"));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "E-Mail-Versand konnte nicht gestartet werden.");
        }
    }

    @PluginMethod
    public void getBiometricAvailability(PluginCall call) {
        Context context = getContext();
        BiometricManager bm = BiometricManager.from(context);
        int authenticators = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            ? (BiometricManager.Authenticators.BIOMETRIC_STRONG
                | BiometricManager.Authenticators.BIOMETRIC_WEAK
                | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
            : (BiometricManager.Authenticators.BIOMETRIC_WEAK
                | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        int canAuth = bm.canAuthenticate(authenticators);
        int hwCheck = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK);

        JSObject res = new JSObject();
        res.put("available", canAuth == BiometricManager.BIOMETRIC_SUCCESS);
        res.put("hasBiometricHardware", hwCheck == BiometricManager.BIOMETRIC_SUCCESS);
        res.put("status", canAuth == BiometricManager.BIOMETRIC_SUCCESS ? "OK" : "UNAVAILABLE_" + canAuth);
        call.resolve(res);
    }

    @PluginMethod
    public void authenticateBiometric(PluginCall call) {
        Activity activity = getActivity();
        if (!(activity instanceof FragmentActivity)) {
            JSObject fail = new JSObject();
            fail.put("authenticated", false);
            fail.put("error", "Biometrie auf dieser Aktivität nicht verfügbar.");
            call.resolve(fail);
            return;
        }

        String title = call.getString("title", "TaktWerk entsperren");
        String subtitle = call.getString("subtitle", "Fingerabdruck, Gesichtserkennung oder Geräte-PIN bestätigen");

        FragmentActivity fragmentActivity = (FragmentActivity) activity;
        fragmentActivity.runOnUiThread(() -> {
            try {
                final boolean[] settled = new boolean[] { false };
                BiometricPrompt prompt = new BiometricPrompt(
                    fragmentActivity,
                    ContextCompat.getMainExecutor(fragmentActivity),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            if (settled[0]) return;
                            settled[0] = true;
                            JSObject ok = new JSObject();
                            ok.put("authenticated", true);
                            call.resolve(ok);
                        }

                        @Override
                        public void onAuthenticationError(int errorCode, CharSequence errString) {
                            if (settled[0]) return;
                            settled[0] = true;
                            JSObject res = new JSObject();
                            res.put("authenticated", false);
                            res.put(
                                "cancelled",
                                errorCode == BiometricPrompt.ERROR_USER_CANCELED
                                    || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                                    || errorCode == BiometricPrompt.ERROR_CANCELED
                            );
                            res.put("error", errString != null ? errString.toString() : "Authentifizierung abgebrochen");
                            call.resolve(res);
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            // System handles retry automatically
                        }
                    }
                );

                int allowedAuth = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? (BiometricManager.Authenticators.BIOMETRIC_STRONG
                        | BiometricManager.Authenticators.BIOMETRIC_WEAK
                        | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                    : (BiometricManager.Authenticators.BIOMETRIC_WEAK
                        | BiometricManager.Authenticators.DEVICE_CREDENTIAL);

                BiometricPrompt.PromptInfo.Builder builder = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setAllowedAuthenticators(allowedAuth);
                prompt.authenticate(builder.build());
            } catch (Exception e) {
                JSObject fail = new JSObject();
                fail.put("authenticated", false);
                fail.put("error", e.getMessage() != null ? e.getMessage() : "Biometrie fehlgeschlagen");
                call.resolve(fail);
            }
        });
    }
}
