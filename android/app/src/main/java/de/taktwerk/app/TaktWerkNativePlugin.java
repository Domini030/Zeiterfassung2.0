package de.taktwerk.app;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
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

@CapacitorPlugin(name = "TaktWerkNative")
public class TaktWerkNativePlugin extends Plugin {

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

    private Uri writeCachePdfAndGetUri(String filename, String base64) throws IOException {
        Context context = getContext();
        String safeName = filename.replaceAll("[^a-zA-Z0-9_.-]", "_");
        if (!safeName.toLowerCase().endsWith(".pdf")) {
            safeName += ".pdf";
        }
        File outFile = new File(context.getCacheDir(), safeName);
        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
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
            Uri uri = writeCachePdfAndGetUri(filename, base64);
            Intent viewIntent = new Intent(Intent.ACTION_VIEW);
            viewIntent.setDataAndType(uri, "application/pdf");
            viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

            try {
                getActivity().startActivity(Intent.createChooser(viewIntent, "Rechnung öffnen"));
                call.resolve();
            } catch (ActivityNotFoundException e) {
                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType("application/pdf");
                shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().startActivity(Intent.createChooser(shareIntent, "Rechnung speichern / teilen"));
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
            Uri uri = writeCachePdfAndGetUri(filename, base64);
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType("application/pdf");
            shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
            shareIntent.putExtra(Intent.EXTRA_SUBJECT, filename);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(shareIntent, "Rechnung teilen / speichern"));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "PDF konnte nicht geteilt werden.");
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
}
