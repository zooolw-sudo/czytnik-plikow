package pl.zooolw.czytnik;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.UriPermission;
import android.graphics.Bitmap;
import android.graphics.ImageDecoder;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Parcelable;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipInputStream;

/**
 * Jedyny ekran aplikacji. Interfejs (ekran startowy i przeglądarki formatów) to strony
 * z assets/web wyświetlane w WebView pod adresem https://appassets.androidplatform.net/.
 * Otwarty plik jest podawany stronie pod adresem /file/&lt;token&gt; – czytany prosto
 * z oryginału (content://) albo z kopii, bez wysyłania gdziekolwiek.
 */
public class MainActivity extends Activity {

    static final String HOST = "appassets.androidplatform.net";
    static final String BASE = "https://" + HOST + "/";
    private static final int REQ_PICK = 1;
    /** Większych plików nie kopiujemy do listy ostatnich. */
    private static final long MAX_COPY = 150L * 1024 * 1024;

    /** Aktualnie wyświetlany plik. */
    static final class Opened {
        Uri uri;
        File local;
        /** Wersja do wyświetlenia (np. zdjęcie HEIC zamienione na JPG); udostępniany jest oryginał. */
        File display;
        String viewType;
        String name, mime, type, token, recentId, source;
        long size, modified;
    }

    private WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private Recents recents;
    private volatile Opened current;
    /** Pliki „nadrzędne” – np. archiwum ZIP, z którego otwarto plik; Wstecz wraca do nich. */
    private final Deque<Opened> parents = new ArrayDeque<>();
    private boolean externalLaunch;
    private boolean inViewer;
    private File childDir;
    private FileOutputStream childOut;
    private File childFile;
    private String childName, childSource;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        recents = new Recents(this);
        childDir = Recents.childrenDir(this, Recents.newId());

        web = new WebView(this);
        web.setBackgroundColor(getResources().getColor(R.color.bg, getTheme()));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setSupportMultipleWindows(false);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.addJavascriptInterface(new Bridge(), "App");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient());

        handleIntent(getIntent());
    }

    @Override
    protected void onDestroy() {
        io.shutdownNow();
        Recents.deleteTree(childDir);
        if (web != null) {
            web.removeJavascriptInterface("App");
            web.destroy();
        }
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */
    /* Otwieranie plików                                                   */
    /* ------------------------------------------------------------------ */

    private void handleIntent(Intent intent) {
        Uri uri = null;
        String action = intent == null ? null : intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            Parcelable p = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (p instanceof Uri) uri = (Uri) p;
            else if (intent.getClipData() != null && intent.getClipData().getItemCount() > 0) {
                uri = intent.getClipData().getItemAt(0).getUri();
            }
        }
        if (uri != null) {
            externalLaunch = true;
            showOpening();
            openUri(uri, intent.getType(), false);
        } else {
            loadHome();
        }
    }

    private void showOpening() {
        inViewer = false;
        web.loadUrl(BASE + "web/index.html?opening=");
    }

    private void loadHome() {
        inViewer = false;
        current = null;
        parents.clear();
        web.loadUrl(BASE + "web/index.html");
    }

    private void pickFile() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(i, REQ_PICK);
        } catch (ActivityNotFoundException e) {
            toast("Brak aplikacji do wyboru plików");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        boolean persisted = false;
        try {
            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            persisted = true;
        } catch (SecurityException ignored) {
            // dostawca nie pozwala na stały dostęp – zrobimy kopię
        }
        externalLaunch = false;
        web.evaluateJavascript("window.showOpening && showOpening('')", null);
        openUri(uri, data.getType(), persisted);
    }

    private void openUri(Uri uri, String mimeHint, boolean persisted) {
        io.execute(() -> {
            Opened o = new Opened();
            o.uri = uri;
            o.source = sourceName(uri);
            queryMeta(o);
            String mime = null;
            try {
                mime = getContentResolver().getType(uri);
            } catch (Exception ignored) {
            }
            if (mime == null || mime.isEmpty() || mime.equals("application/octet-stream")) {
                if (mimeHint != null && !mimeHint.contains("*")) mime = mimeHint;
            }
            o.mime = mime;
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IOException("Brak danych");
                o.type = FileTypes.detect(in, o.name, mime);
            } catch (SecurityException | IOException e) {
                main.post(() -> {
                    toast("Nie można odczytać pliku – brak dostępu albo plik został usunięty.");
                    if (externalLaunch) finish(); else loadHome();
                });
                return;
            }
            o.mime = FileTypes.mimeFor(o.name, o.type, o.mime);
            o.token = Recents.newId();
            prepareDisplay(o);
            current = o;
            main.post(() -> showViewer(o));
            remember(o, persisted);
        });
    }

    private void openRecent(String id) {
        Recents.Item it = recents.get(id);
        if (it == null) return;
        externalLaunch = false;
        if (it.local != null) {
            File f = new File(Recents.copiesDir(this), it.local);
            if (!f.isFile()) {
                recents.remove(id);
                toast("Kopia pliku nie jest już dostępna. Otwórz plik ponownie.");
                refreshHome();
                return;
            }
            Opened o = new Opened();
            o.local = f;
            o.name = it.name;
            o.size = f.length();
            o.type = it.type;
            o.mime = FileTypes.mimeFor(it.name, it.type, it.mime);
            o.token = Recents.newId();
            o.recentId = it.id;
            o.source = "Kopia zapisana w aplikacji";
            o.modified = f.lastModified();
            it.time = System.currentTimeMillis();
            recents.put(it);
            io.execute(() -> {
                prepareDisplay(o);
                current = o;
                main.post(() -> showViewer(o));
            });
            return;
        }
        if (it.uri != null) {
            Uri u = Uri.parse(it.uri);
            io.execute(() -> {
                boolean ok;
                try (InputStream in = getContentResolver().openInputStream(u)) {
                    ok = in != null;
                } catch (Exception e) {
                    ok = false;
                }
                if (!ok) {
                    recents.remove(id);
                    main.post(() -> {
                        toast("Plik jest niedostępny – mógł zostać przeniesiony lub usunięty.");
                        refreshHome();
                    });
                    return;
                }
                main.post(() -> web.evaluateJavascript("window.showOpening && showOpening(" + JSONObject.quote(it.name) + ")", null));
                openUri(u, it.mime, true);
            });
        }
    }

    /** Zapis na liście ostatnich (w tle). Pliki bez stałego dostępu są kopiowane. */
    private void remember(Opened o, boolean persisted) {
        try {
            Recents.Item it = null;
            if (persisted || hasPersisted(o.uri)) {
                it = recents.findByUri(o.uri.toString());
                if (it == null) {
                    it = new Recents.Item();
                    it.id = Recents.newId();
                }
                if (it.local != null) {
                    //noinspection ResultOfMethodCallIgnored
                    new File(Recents.copiesDir(this), it.local).delete();
                    it.local = null;
                }
                it.uri = o.uri.toString();
            } else {
                it = recents.findCopy(o.name, o.size);
                File copy = it != null ? new File(Recents.copiesDir(this), it.local) : null;
                if (it == null || !copy.isFile()) {
                    if (o.size > MAX_COPY) return;
                    if (it == null) {
                        it = new Recents.Item();
                        it.id = Recents.newId();
                    }
                    copy = new File(Recents.copiesDir(this), it.id + ".bin");
                    if (!copyTo(o.uri, copy)) return;
                    it.local = copy.getName();
                    if (o.size <= 0) o.size = copy.length();
                }
                it.uri = null;
                o.local = copy;
            }
            it.name = o.name;
            it.size = o.size;
            it.type = o.type;
            it.mime = o.mime;
            it.time = System.currentTimeMillis();
            recents.put(it);
            o.recentId = it.id;
        } catch (Exception ignored) {
            // lista ostatnich to tylko wygoda – błąd nie przeszkadza w oglądaniu
        }
    }

    private boolean hasPersisted(Uri uri) {
        for (UriPermission p : getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(uri) && p.isReadPermission()) return true;
        }
        return false;
    }

    private boolean copyTo(Uri uri, File dst) {
        File tmp = new File(dst.getPath() + ".tmp");
        try (InputStream in = getContentResolver().openInputStream(uri);
             OutputStream out = new FileOutputStream(tmp)) {
            if (in == null) return false;
            byte[] buf = new byte[64 * 1024];
            long total = 0;
            int r;
            while ((r = in.read(buf)) > 0) {
                out.write(buf, 0, r);
                total += r;
                if (total > MAX_COPY) throw new IOException("za duży");
            }
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            return false;
        }
        return tmp.renameTo(dst);
    }

    private void queryMeta(Opened o) {
        o.name = null;
        o.size = -1;
        try (Cursor c = getContentResolver().query(o.uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int s = c.getColumnIndex(OpenableColumns.SIZE);
                int m = c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                if (n >= 0 && !c.isNull(n)) o.name = c.getString(n);
                if (s >= 0 && !c.isNull(s)) o.size = c.getLong(s);
                if (m >= 0 && !c.isNull(m)) o.modified = c.getLong(m);
            }
        } catch (Exception ignored) {
        }
        if (o.name == null || o.name.trim().isEmpty()) {
            String last = o.uri.getLastPathSegment();
            o.name = last == null ? "plik" : last.substring(last.lastIndexOf('/') + 1);
        }
    }

    private static String sourceName(Uri uri) {
        String a = uri.getAuthority();
        if (a == null) return null;
        if (a.equals("com.android.externalstorage.documents")) return "Pamięć urządzenia";
        if (a.equals("com.android.providers.downloads.documents") || a.equals("downloads")) return "Pobrane";
        if (a.startsWith("com.google.android.apps.docs")) return "Dysk Google";
        if (a.startsWith("com.google.android.gm") || a.startsWith("gmail")) return "Gmail";
        if (a.equals("media") || a.startsWith("com.android.providers.media")) return "Multimedia";
        if (a.contains("whatsapp")) return "WhatsApp";
        if (a.contains("onedrive") || a.contains("skydrive")) return "OneDrive";
        return a;
    }

    /** Przygotowanie pliku do pokazania (w tle): zdjęcia HEIC/HEIF zamieniane na JPG. */
    private void prepareDisplay(Opened o) {
        if (!"heic".equals(o.type)) return;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            o.viewType = "heic";
            return;
        }
        try {
            ImageDecoder.Source src = o.local != null && o.local.isFile()
                    ? ImageDecoder.createSource(o.local)
                    : ImageDecoder.createSource(getContentResolver(), o.uri);
            Bitmap bmp = ImageDecoder.decodeBitmap(src, (decoder, info, source) -> {
                decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                int max = Math.max(info.getSize().getWidth(), info.getSize().getHeight());
                if (max > 4096) decoder.setTargetSampleSize((int) Math.ceil(max / 4096.0));
            });
            File out = new File(childDir, Recents.newId() + ".jpg");
            try (OutputStream os = new FileOutputStream(out)) {
                bmp.compress(Bitmap.CompressFormat.JPEG, 90, os);
            }
            bmp.recycle();
            o.display = out;
            o.viewType = "image";
        } catch (Exception | OutOfMemoryError e) {
            o.viewType = "heic";
        }
    }

    private void showViewer(Opened o) {
        String page;
        String extra = "";
        String t = o.viewType != null ? o.viewType : o.type;
        switch (t) {
            case "pdf": page = "pdf.html"; break;
            case "docx": page = "docx.html"; break;
            case "odt": page = "odt.html"; break;
            case "sheet": case "csv": page = "sheet.html"; break;
            case "text": page = "text.html"; break;
            case "xml": page = "xml.html"; break;
            case "zip": page = "zip.html"; break;
            case "eml": page = "eml.html"; break;
            case "md": case "html": page = "md.html"; break;
            case "epub": page = "epub.html"; break;
            case "rtf": page = "rtf.html"; break;
            case "pptx": case "odp": page = "slides.html"; break;
            case "image": page = "image.html"; break;
            default:
                page = "unsupported.html";
                extra = "&reason=" + enc(o.type);
        }
        String url = BASE + "web/" + page
                + "?src=" + enc("/file/" + o.token)
                + "&name=" + enc(o.name)
                + "&type=" + enc(t)
                + "&size=" + Math.max(0, o.size)
                + extra;
        inViewer = true;
        web.loadUrl(url);
    }

    private void refreshHome() {
        if (!inViewer) web.evaluateJavascript("window.onRecentsChanged && onRecentsChanged()", null);
    }

    /* ------------------------------------------------------------------ */
    /* Wstecz, udostępnianie, otwieranie w innej aplikacji                 */
    /* ------------------------------------------------------------------ */

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.handleBack ? String(window.handleBack()) : 'false'", v -> {
            if (v != null && v.contains("true")) return;
            navigateBack();
        });
    }

    private void navigateBack() {
        if (inViewer && !parents.isEmpty()) {
            current = parents.pop();
            showViewer(current);
            return;
        }
        if (inViewer && !externalLaunch) loadHome();
        else finish();
    }

    /* ------------------------------------------------------------------ */
    /* Pliki podrzędne: zawartość archiwów ZIP i załączniki e-maili         */
    /* ------------------------------------------------------------------ */

    /** Otwiera plik wyjęty z innego pliku; Wstecz wraca do pliku nadrzędnego. */
    private void openChild(File f, String name, String source) {
        io.execute(() -> {
            Opened o = new Opened();
            o.local = f;
            o.name = name;
            o.size = f.length();
            o.modified = f.lastModified();
            o.source = source;
            try (InputStream in = new FileInputStream(f)) {
                o.type = FileTypes.detect(in, name, null);
            } catch (IOException e) {
                toast("Nie udało się otworzyć pliku");
                return;
            }
            o.mime = FileTypes.mimeFor(name, o.type, null);
            o.token = Recents.newId();
            prepareDisplay(o);
            main.post(() -> {
                Opened parent = current;
                if (parent != null) parents.push(parent);
                current = o;
                showViewer(o);
            });
        });
    }

    private static String baseName(String path) {
        String p = path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
        return p.substring(p.lastIndexOf('/') + 1);
    }

    private InputStream openCurrent(Opened o) throws IOException {
        InputStream in = o.local != null && o.local.isFile() ? new FileInputStream(o.local) : getContentResolver().openInputStream(o.uri);
        if (in == null) throw new IOException("Brak danych");
        return in;
    }

    /** Nazwy w archiwach z polskiego Windowsa bywają w kodowaniu CP852 zamiast UTF-8. */
    private static final String[] ZIP_CHARSETS = {"UTF-8", "IBM852", "windows-1250", "ISO-8859-1"};

    private Charset zipCharset(String name) {
        try {
            return Charset.forName(name);
        } catch (Exception e) {
            return null;
        }
    }

    private String zipList() {
        Opened o = current;
        if (o == null) return "{\"error\":\"Brak pliku\"}";
        for (String csName : ZIP_CHARSETS) {
            Charset cs = zipCharset(csName);
            if (cs == null) continue;
            JSONArray arr = new JSONArray();
            try (ZipInputStream z = new ZipInputStream(openCurrent(o), cs)) {
                ZipEntry e;
                int count = 0;
                byte[] skip = new byte[64 * 1024];
                while ((e = z.getNextEntry()) != null && count++ < 20000) {
                    long size = e.getSize();
                    if (!e.isDirectory() && size < 0) {
                        size = 0;
                        int r;
                        while ((r = z.read(skip)) > 0) size += r;
                    }
                    JSONObject j = new JSONObject();
                    j.put("p", e.getName());
                    j.put("d", e.isDirectory());
                    j.put("s", size);
                    j.put("t", e.getTime());
                    arr.put(j);
                }
                JSONObject res = new JSONObject();
                res.put("entries", arr);
                res.put("charset", csName);
                return res.toString();
            } catch (IllegalArgumentException bad) {
                // błędne nazwy w tym kodowaniu – próbujemy następnego
            } catch (Exception ex) {
                try {
                    JSONObject res = new JSONObject();
                    res.put("error", ex.getMessage() == null ? "Uszkodzone archiwum" : ex.getMessage());
                    res.put("entries", arr);
                    return res.toString();
                } catch (JSONException ignored) {
                    return "{\"error\":\"Uszkodzone archiwum\"}";
                }
            }
        }
        return "{\"error\":\"Nie udało się odczytać nazw plików w archiwum\"}";
    }

    private void zipOpen(String path, String charset) {
        Opened o = current;
        if (o == null) return;
        io.execute(() -> {
            Charset cs = zipCharset(charset == null ? "UTF-8" : charset);
            File out = new File(childDir, Recents.newId() + ".bin");
            boolean found = false;
            try (ZipInputStream z = new ZipInputStream(openCurrent(o), cs == null ? StandardCharsets.UTF_8 : cs)) {
                ZipEntry e;
                while ((e = z.getNextEntry()) != null) {
                    if (!e.getName().equals(path)) continue;
                    found = true;
                    try (OutputStream os = new FileOutputStream(out)) {
                        byte[] buf = new byte[64 * 1024];
                        long total = 0;
                        int r;
                        while ((r = z.read(buf)) > 0) {
                            os.write(buf, 0, r);
                            total += r;
                            if (total > 1024L * 1024 * 1024) throw new IOException("Plik po rozpakowaniu jest za duży");
                        }
                    }
                    break;
                }
            } catch (ZipException ze) {
                //noinspection ResultOfMethodCallIgnored
                out.delete();
                String m = ze.getMessage() == null ? "" : ze.getMessage();
                toast(m.contains("encrypt") ? "Ten plik w archiwum jest zaszyfrowany hasłem" : "Nie udało się rozpakować pliku");
                main.post(() -> web.evaluateJavascript("window.onChildFailed && onChildFailed()", null));
                return;
            } catch (Exception ex) {
                //noinspection ResultOfMethodCallIgnored
                out.delete();
                toast("Nie udało się rozpakować pliku");
                main.post(() -> web.evaluateJavascript("window.onChildFailed && onChildFailed()", null));
                return;
            }
            if (!found) {
                toast("Nie znaleziono pliku w archiwum");
                main.post(() -> web.evaluateJavascript("window.onChildFailed && onChildFailed()", null));
                return;
            }
            openChild(out, baseName(path), "Archiwum " + o.name);
        });
    }

    /** Adres pliku, który można przekazać innej aplikacji. */
    private Uri shareableUri(Opened o) {
        if (o.local != null && o.local.isFile()) return FilesProvider.uriFor(this, o.local, o.name);
        return o.uri;
    }

    private void share() {
        Opened o = current;
        if (o == null) return;
        Uri u = shareableUri(o);
        Intent s = new Intent(Intent.ACTION_SEND);
        s.setType(o.mime);
        s.putExtra(Intent.EXTRA_STREAM, u);
        s.setClipData(ClipData.newRawUri(o.name, u));
        s.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(s, "Udostępnij: " + o.name));
        } catch (Exception e) {
            toast("Nie udało się udostępnić pliku");
        }
    }

    private void openWith() {
        Opened o = current;
        if (o == null) return;
        Uri u = shareableUri(o);
        Intent v = new Intent(Intent.ACTION_VIEW);
        v.setDataAndType(u, o.mime);
        v.setClipData(ClipData.newRawUri(o.name, u));
        v.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(v, "Otwórz za pomocą");
        chooser.putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, new ComponentName[]{new ComponentName(this, MainActivity.class)});
        try {
            startActivity(chooser);
        } catch (Exception e) {
            toast("Brak innej aplikacji do otwarcia tego pliku");
        }
    }

    private void openExternalUrl(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https") && !scheme.equals("mailto") && !scheme.equals("tel")) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException e) {
            toast("Brak aplikacji do otwarcia linku");
        }
    }

    private void toast(String msg) {
        main.post(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s == null ? "" : s, "UTF-8").replace("+", "%20");
        } catch (UnsupportedEncodingException e) {
            return "";
        }
    }

    /* ------------------------------------------------------------------ */
    /* Most dla stron (window.App)                                         */
    /* ------------------------------------------------------------------ */

    private final class Bridge {
        @JavascriptInterface
        public String recents() {
            return recents.toJson();
        }

        @JavascriptInterface
        public void pickFile() {
            main.post(MainActivity.this::pickFile);
        }

        @JavascriptInterface
        public void openRecent(String id) {
            main.post(() -> MainActivity.this.openRecent(id));
        }

        @JavascriptInterface
        public void removeRecent(String id) {
            recents.remove(id);
        }

        @JavascriptInterface
        public void clearRecents() {
            recents.clear();
        }

        @JavascriptInterface
        public void back() {
            main.post(MainActivity.this::navigateBack);
        }

        @JavascriptInterface
        public void share() {
            main.post(MainActivity.this::share);
        }

        @JavascriptInterface
        public void openWith() {
            main.post(MainActivity.this::openWith);
        }

        @JavascriptInterface
        public void openUrl(String url) {
            main.post(() -> openExternalUrl(Uri.parse(url)));
        }

        @JavascriptInterface
        public void setTitle(String title) {
            main.post(() -> MainActivity.this.setTitle(title));
        }

        @JavascriptInterface
        public String fileInfo() {
            Opened o = current;
            JSONObject j = new JSONObject();
            if (o == null) return "{}";
            try {
                j.put("name", o.name);
                j.put("size", o.local != null && o.local.isFile() && o.size <= 0 ? o.local.length() : o.size);
                j.put("mime", o.mime);
                if (o.modified > 0) j.put("modified", o.modified);
                if (o.source != null) j.put("source", o.source);
            } catch (JSONException ignored) {
            }
            return j.toString();
        }

        @JavascriptInterface
        public String zipList() {
            return MainActivity.this.zipList();
        }

        @JavascriptInterface
        public void zipOpen(String path, String charset) {
            MainActivity.this.zipOpen(path, charset);
        }

        /** Przekazanie pliku ze strony (np. załącznika e-maila) w kawałkach base64. */
        @JavascriptInterface
        public void childBegin(String name, String source) {
            try {
                if (childOut != null) childOut.close();
                childFile = new File(childDir, Recents.newId() + ".bin");
                childOut = new FileOutputStream(childFile);
                childName = name == null || name.isEmpty() ? "plik" : name;
                childSource = source;
            } catch (IOException e) {
                childOut = null;
            }
        }

        @JavascriptInterface
        public void childChunk(String b64) {
            if (childOut == null) return;
            try {
                childOut.write(Base64.decode(b64, Base64.DEFAULT));
            } catch (Exception e) {
                try {
                    childOut.close();
                } catch (IOException ignored) {
                }
                childOut = null;
            }
        }

        @JavascriptInterface
        public void childEnd() {
            if (childOut == null) {
                toast("Nie udało się otworzyć pliku");
                return;
            }
            try {
                childOut.close();
            } catch (IOException ignored) {
            }
            childOut = null;
            openChild(childFile, childName, childSource);
        }

        @JavascriptInterface
        public void copy(String text) {
            main.post(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Czytnik plików", text));
            });
        }

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Serwowanie stron i pliku do WebView                                 */
    /* ------------------------------------------------------------------ */

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (HOST.equals(u.getHost())) return false;
            openExternalUrl(u);
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            String scheme = u.getScheme();
            if (!"http".equals(scheme) && !"https".equals(scheme)) return null;
            // dokumenty nie mogą niczego pobierać z internetu (prywatność, śledzące obrazki)
            if (!HOST.equals(u.getHost())) return error(403, "Forbidden");
            String path = u.getPath() == null ? "" : u.getPath();
            if (path.startsWith("/web/")) return asset(path.substring(1));
            if (path.startsWith("/file/")) return file(path.substring(6));
            return error(404, "Not Found");
        }
    }

    private WebResourceResponse asset(String path) {
        if (path.contains("..")) return error(404, "Not Found");
        try {
            InputStream in = getAssets().open(path);
            String mime = mimeOf(path);
            boolean text = mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json") || mime.endsWith("svg+xml");
            return new WebResourceResponse(mime, text ? "utf-8" : null, 200, "OK", headers(), in);
        } catch (IOException e) {
            return error(404, "Not Found");
        }
    }

    private WebResourceResponse file(String token) {
        Opened o = current;
        int slash = token.indexOf('/');
        if (slash >= 0) token = token.substring(0, slash);
        if (o == null || !token.equals(o.token)) return error(404, "Not Found");
        try {
            InputStream in = o.display != null && o.display.isFile() ? new FileInputStream(o.display)
                    : o.local != null && o.local.isFile() ? new FileInputStream(o.local)
                    : getContentResolver().openInputStream(o.uri);
            if (in == null) return error(404, "Not Found");
            String mime = o.display != null ? "image/jpeg" : "image".equals(o.type) && o.mime.contains("*") ? "image/png" : o.mime;
            return new WebResourceResponse(mime, null, 200, "OK", headers(), in);
        } catch (Exception e) {
            return error(404, "Not Found");
        }
    }

    private static Map<String, String> headers() {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        h.put("Access-Control-Allow-Origin", "*");
        return h;
    }

    private static WebResourceResponse error(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, headers(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeOf(String path) {
        String e = FileTypes.ext(path);
        switch (e) {
            case "html": return "text/html";
            case "js": case "mjs": return "text/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "wasm": return "application/wasm";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "ftl": case "txt": return "text/plain";
            default: return "application/octet-stream";
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && (Intent.ACTION_VIEW.equals(intent.getAction()) || Intent.ACTION_SEND.equals(intent.getAction()))) {
            handleIntent(intent);
        }
    }
}
