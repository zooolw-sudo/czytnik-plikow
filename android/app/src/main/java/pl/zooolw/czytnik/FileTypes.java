package pl.zooolw.czytnik;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Rozpoznawanie rodzaju pliku po zawartości (nagłówek, wnętrze archiwum ZIP),
 * a dopiero w drugiej kolejności po rozszerzeniu i typie MIME.
 *
 * Wynik: pdf, docx, odt, sheet, csv, xml, text, image
 * albo nieobsługiwane: doc, ppt, encrypted, zip, rtf, odf, unknown.
 */
final class FileTypes {

    private FileTypes() {}

    private static final Set<String> TEXT_EXT = new HashSet<>(Arrays.asList(
            "txt", "log", "json", "ini", "cfg", "conf", "yaml", "yml", "properties",
            "js", "py", "java", "kt", "c", "h", "cpp", "ino", "sql", "sh", "bat", "srt", "nfo",
            "gcode", "nc", "css", "tex"));
    private static final Set<String> XML_EXT = new HashSet<>(Arrays.asList(
            "xml", "xsd", "xsl", "xslt", "rss", "atom", "gpx", "kml", "xades", "xaml", "wsdl", "plist", "jpk", "upo"));
    private static final Set<String> IMAGE_EXT = new HashSet<>(Arrays.asList(
            "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif", "avif"));

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("pdf", "application/pdf");
        MIME.put("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        MIME.put("docm", "application/vnd.ms-word.document.macroEnabled.12");
        MIME.put("dotx", "application/vnd.openxmlformats-officedocument.wordprocessingml.template");
        MIME.put("doc", "application/msword");
        MIME.put("odt", "application/vnd.oasis.opendocument.text");
        MIME.put("ott", "application/vnd.oasis.opendocument.text-template");
        MIME.put("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        MIME.put("xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12");
        MIME.put("xlsb", "application/vnd.ms-excel.sheet.binary.macroEnabled.12");
        MIME.put("xltx", "application/vnd.openxmlformats-officedocument.spreadsheetml.template");
        MIME.put("xls", "application/vnd.ms-excel");
        MIME.put("ods", "application/vnd.oasis.opendocument.spreadsheet");
        MIME.put("csv", "text/csv");
        MIME.put("tsv", "text/tab-separated-values");
        MIME.put("txt", "text/plain");
        MIME.put("json", "application/json");
        MIME.put("xml", "text/xml");
        MIME.put("xades", "application/xml");
        MIME.put("eml", "message/rfc822");
        MIME.put("mht", "multipart/related");
        MIME.put("mhtml", "multipart/related");
        MIME.put("md", "text/markdown");
        MIME.put("html", "text/html");
        MIME.put("htm", "text/html");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("png", "image/png");
        MIME.put("gif", "image/gif");
        MIME.put("webp", "image/webp");
        MIME.put("bmp", "image/bmp");
        MIME.put("svg", "image/svg+xml");
        MIME.put("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        MIME.put("ppt", "application/vnd.ms-powerpoint");
        MIME.put("zip", "application/zip");
        MIME.put("rtf", "application/rtf");
    }

    static String ext(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "";
        return name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    /** Typ MIME do udostępniania/otwierania w innej aplikacji. */
    static String mimeFor(String name, String type, String known) {
        if (known != null && !known.isEmpty() && !known.equals("application/octet-stream")) return known;
        String m = MIME.get(ext(name));
        if (m != null) return m;
        switch (type == null ? "" : type) {
            case "pdf": return "application/pdf";
            case "docx": return MIME.get("docx");
            case "odt": return MIME.get("odt");
            case "sheet": return MIME.get("xlsx");
            case "csv": return "text/csv";
            case "text": return "text/plain";
            case "xml": return "text/xml";
            case "eml": return "message/rfc822";
            case "md": return "text/markdown";
            case "html": return "text/html";
            case "image": return "image/*";
            default: return "application/octet-stream";
        }
    }

    static String detect(InputStream raw, String name, String mime) throws IOException {
        BufferedInputStream in = new BufferedInputStream(raw, 64 * 1024);
        in.mark(64 * 1024);
        byte[] head = new byte[4096];
        int n = readFully(in, head);
        in.reset();
        String ext = ext(name);
        String m = mime == null ? "" : mime.toLowerCase(Locale.ROOT);

        if (n >= 4) {
            int pdf = indexOf(head, n, "%PDF-".getBytes(StandardCharsets.US_ASCII));
            if (pdf >= 0 && pdf < 1024) return "pdf";
            if (head[0] == 'P' && head[1] == 'K' && head[2] == 3 && head[3] == 4) return zipKind(in, ext);
            if ((head[0] & 0xff) == 0xD0 && (head[1] & 0xff) == 0xCF && (head[2] & 0xff) == 0x11 && (head[3] & 0xff) == 0xE0) {
                return oleKind(ext, m);
            }
            if ((head[0] & 0xff) == 0xFF && (head[1] & 0xff) == 0xD8 && (head[2] & 0xff) == 0xFF) return "image";
            if ((head[0] & 0xff) == 0x89 && head[1] == 'P' && head[2] == 'N' && head[3] == 'G') return "image";
            if (head[0] == 'G' && head[1] == 'I' && head[2] == 'F' && head[3] == '8') return "image";
            if (n >= 12 && head[0] == 'R' && head[1] == 'I' && head[2] == 'F' && head[3] == 'F'
                    && head[8] == 'W' && head[9] == 'E' && head[10] == 'B' && head[11] == 'P') return "image";
            if (head[0] == 'B' && head[1] == 'M' && (ext.equals("bmp") || m.startsWith("image/"))) return "image";
            if (head[0] == '{' && head[1] == '\\' && head[2] == 'r' && head[3] == 't') return "rtf";
            if (head[0] == 'R' && head[1] == 'a' && head[2] == 'r' && head[3] == '!') return "archive";
            if (head[0] == '7' && head[1] == 'z' && (head[2] & 0xff) == 0xBC && (head[3] & 0xff) == 0xAF) return "archive";
        }
        if (ext.equals("csv") || ext.equals("tsv") || m.equals("text/csv") || m.equals("text/comma-separated-values")
                || m.equals("application/csv") || m.contains("tab-separated")) return "csv";
        if (ext.equals("svg") || (IMAGE_EXT.contains(ext) && m.startsWith("image/"))) return "image";
        if (XML_EXT.contains(ext)) return "xml";
        if (ext.equals("eml") || ext.equals("mht") || ext.equals("mhtml") || m.equals("message/rfc822") || m.equals("multipart/related")) return "eml";
        if (ext.equals("md") || ext.equals("markdown") || ext.equals("mkd") || m.equals("text/markdown") || m.equals("text/x-markdown")) return "md";
        if (ext.equals("html") || ext.equals("htm") || ext.equals("xhtml")) return "html";
        String start = textStart(head, n);
        String low = start.toLowerCase(Locale.ROOT);
        if (low.startsWith("<!doctype html") || low.startsWith("<html")) return "html";
        if (ext.isEmpty() && looksLikeMail(start)) return "eml";
        if (start.startsWith("<?xml")) {
            String lower = start.toLowerCase(Locale.ROOT);
            if (lower.contains("<svg")) return "image";
            if (!lower.contains("<html")) return "xml";
        }
        if (m.equals("text/xml") || m.equals("application/xml")) return "xml";
        if (m.equals("text/html")) return "html";
        if (TEXT_EXT.contains(ext) || m.startsWith("text/") || m.equals("application/json")) return "text";
        if (n == 0) return "text";
        if (looksLikeText(head, n)) return "text";
        if (IMAGE_EXT.contains(ext)) return "image";
        return "unknown";
    }

    private static String oleKind(String ext, String m) {
        switch (ext) {
            case "xls": case "xlt": case "xla": return "sheet";
            case "doc": case "dot": return "doc";
            case "msg": return "msg";
            case "ppt": case "pps": case "pot": return "ppt";
            case "docx": case "docm": case "dotx": case "xlsx": case "xlsm": case "xlsb": case "pptx":
                return "encrypted";   // zaszyfrowane pliki Office są zapisane w kontenerze OLE
            default:
                if (m.contains("excel")) return "sheet";
                if (m.contains("msword")) return "doc";
                if (m.contains("powerpoint")) return "ppt";
                if (m.contains("openxmlformats")) return "encrypted";
                return "unknown";
        }
    }

    private static String zipKind(InputStream in, String ext) {
        try {
            ZipInputStream z = new ZipInputStream(in);
            ZipEntry e;
            int count = 0;
            while ((e = z.getNextEntry()) != null && count++ < 4000) {
                String nm = e.getName();
                if (nm.equals("mimetype")) {
                    String mt = readSmall(z, 200).trim();
                    if (mt.startsWith("application/vnd.oasis.opendocument.text")) return "odt";
                    if (mt.startsWith("application/vnd.oasis.opendocument.spreadsheet")) return "sheet";
                    return "odf";
                }
                if (nm.startsWith("word/")) return "docx";
                if (nm.startsWith("xl/")) return "sheet";
                if (nm.startsWith("ppt/")) return "ppt";
            }
        } catch (IOException | IllegalArgumentException ex) {
            // nietypowe archiwum – zdecyduje rozszerzenie
        }
        switch (ext) {
            case "docx": case "docm": case "dotx": return "docx";
            case "xlsx": case "xlsm": case "xltx": case "ods": return "sheet";
            case "odt": case "ott": return "odt";
            case "pptx": case "odp": return "ppt";
            default: return "zip";
        }
    }

    /** Plik bez rozszerzenia zaczynający się nagłówkami poczty. */
    private static boolean looksLikeMail(String s) {
        int hits = 0;
        for (String h : new String[]{"received:", "from:", "to:", "subject:", "date:", "mime-version:", "message-id:", "return-path:", "delivered-to:"}) {
            if (s.regionMatches(true, 0, h, 0, h.length()) || s.toLowerCase(Locale.ROOT).contains("\n" + h)) hits++;
        }
        return hits >= 3;
    }

    private static boolean looksLikeText(byte[] b, int n) {
        if (n >= 2 && (((b[0] & 0xff) == 0xFF && (b[1] & 0xff) == 0xFE) || ((b[0] & 0xff) == 0xFE && (b[1] & 0xff) == 0xFF))) return true;
        int bad = 0;
        for (int i = 0; i < n; i++) {
            int c = b[i] & 0xff;
            if (c == 0) return false;
            if (c < 9 || (c > 13 && c < 32 && c != 27)) bad++;
        }
        return bad * 50 < n;
    }

    /** Początek pliku tekstowego jako napis (UTF-8 albo UTF-16 z BOM), bez BOM i początkowych spacji. */
    private static String textStart(byte[] b, int n) {
        String s;
        if (n >= 2 && (b[0] & 0xff) == 0xFF && (b[1] & 0xff) == 0xFE) s = new String(b, 2, n - 2, StandardCharsets.UTF_16LE);
        else if (n >= 2 && (b[0] & 0xff) == 0xFE && (b[1] & 0xff) == 0xFF) s = new String(b, 2, n - 2, StandardCharsets.UTF_16BE);
        else s = new String(b, 0, n, StandardCharsets.UTF_8);
        int i = 0;
        while (i < s.length() && (Character.isWhitespace(s.charAt(i)) || s.charAt(i) == '\uFEFF')) i++;
        return s.substring(i, Math.min(s.length(), i + 1024));
    }

    private static int readFully(InputStream in, byte[] buf) throws IOException {
        int off = 0;
        while (off < buf.length) {
            int r = in.read(buf, off, buf.length - off);
            if (r < 0) break;
            off += r;
        }
        return off;
    }

    private static String readSmall(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[256];
        int r;
        while (out.size() < max && (r = in.read(buf)) > 0) out.write(buf, 0, r);
        return new String(out.toByteArray(), StandardCharsets.US_ASCII);
    }

    private static int indexOf(byte[] hay, int n, byte[] needle) {
        outer:
        for (int i = 0; i + needle.length <= n; i++) {
            for (int j = 0; j < needle.length; j++) if (hay[i + j] != needle[j]) continue outer;
            return i;
        }
        return -1;
    }
}
