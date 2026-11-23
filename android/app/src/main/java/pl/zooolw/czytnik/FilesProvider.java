package pl.zooolw.czytnik;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.List;

/**
 * Udostępnia innym aplikacjom (tylko do odczytu) kopie plików przechowywane przez czytnik,
 * np. przy „Udostępnij” albo „Otwórz w innej aplikacji”.
 * Adres: content://pl.zooolw.czytnik.pliki/&lt;plik kopii&gt;/&lt;nazwa wyświetlana&gt;
 */
public class FilesProvider extends ContentProvider {

    static String authority(Context c) {
        return c.getPackageName() + ".pliki";
    }

    static Uri uriFor(Context c, File f, String displayName) {
        return new Uri.Builder().scheme("content").authority(authority(c))
                .appendPath(f.getName()).appendPath(displayName == null ? f.getName() : displayName).build();
    }

    private File fileFor(Uri uri) {
        List<String> seg = uri.getPathSegments();
        if (seg.isEmpty()) return null;
        String n = seg.get(0);
        if (n.contains("/") || n.contains("..")) return null;
        File f = new File(Recents.copiesDir(getContext()), n);
        return f.isFile() ? f : null;
    }

    private static String displayName(Uri uri) {
        List<String> seg = uri.getPathSegments();
        return seg.size() > 1 ? seg.get(1) : (seg.isEmpty() ? "plik" : seg.get(0));
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (mode == null || !mode.startsWith("r") || mode.contains("w")) throw new SecurityException("Tylko odczyt");
        File f = fileFor(uri);
        if (f == null) throw new FileNotFoundException(uri.toString());
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f = fileFor(uri);
        if (f == null) return null;
        String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = displayName(uri);
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        c.addRow(row);
        return c;
    }

    @Override
    public String getType(Uri uri) {
        return FileTypes.mimeFor(displayName(uri), null, null);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
