package pl.zooolw.czytnik;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Lista ostatnio otwieranych plików. Plik z trwałym dostępem (wybrany w aplikacji)
 * jest zapamiętany po adresie, a plik otwarty z innej aplikacji (Gmail, Dysk…) –
 * jako kopia w pamięci aplikacji, bo dostęp do oryginału wygasa.
 */
final class Recents {

    static final int MAX = 40;

    static final class Item {
        String id, name, type, mime, uri, local;
        long size, time;

        JSONObject toJson(boolean full) throws JSONException {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("name", name);
            o.put("type", type);
            o.put("size", size);
            o.put("time", time);
            if (full) {
                o.put("mime", mime);
                o.put("uri", uri);
                o.put("local", local);
            }
            return o;
        }

        static Item fromJson(JSONObject o) {
            Item it = new Item();
            it.id = o.optString("id");
            it.name = o.optString("name");
            it.type = o.optString("type");
            it.mime = o.isNull("mime") ? null : o.optString("mime", null);
            it.uri = o.isNull("uri") ? null : o.optString("uri", null);
            it.local = o.isNull("local") ? null : o.optString("local", null);
            it.size = o.optLong("size");
            it.time = o.optLong("time");
            return it;
        }
    }

    private final Context ctx;
    private final SharedPreferences prefs;
    private final List<Item> items = new ArrayList<>();

    Recents(Context c) {
        ctx = c.getApplicationContext();
        prefs = ctx.getSharedPreferences("recents", Context.MODE_PRIVATE);
        try {
            JSONArray a = new JSONArray(prefs.getString("items", "[]"));
            for (int i = 0; i < a.length(); i++) items.add(Item.fromJson(a.getJSONObject(i)));
        } catch (JSONException e) {
            items.clear();
        }
    }

    static File copiesDir(Context c) {
        File d = new File(c.getFilesDir(), "kopie");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    static String newId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    }

    synchronized String toJson() {
        JSONArray a = new JSONArray();
        try {
            for (Item it : items) a.put(it.toJson(false));
        } catch (JSONException ignored) {
        }
        return a.toString();
    }

    synchronized Item get(String id) {
        for (Item it : items) if (it.id.equals(id)) return it;
        return null;
    }

    synchronized Item findByUri(String uri) {
        for (Item it : items) if (uri.equals(it.uri)) return it;
        return null;
    }

    synchronized Item findCopy(String name, long size) {
        for (Item it : items) {
            if (it.local != null && it.name.equals(name) && it.size == size) return it;
        }
        return null;
    }

    /** Dodaje lub odświeża wpis i przenosi go na początek listy. */
    synchronized void put(Item it) {
        items.remove(it);
        for (int i = items.size() - 1; i >= 0; i--) if (items.get(i).id.equals(it.id)) items.remove(i);
        items.add(0, it);
        while (items.size() > MAX) dispose(items.remove(items.size() - 1));
        save();
    }

    synchronized void remove(String id) {
        for (int i = items.size() - 1; i >= 0; i--) {
            if (items.get(i).id.equals(id)) dispose(items.remove(i));
        }
        save();
    }

    synchronized void clear() {
        for (Item it : items) dispose(it);
        items.clear();
        save();
    }

    private void dispose(Item it) {
        if (it.local != null) {
            //noinspection ResultOfMethodCallIgnored
            new File(copiesDir(ctx), it.local).delete();
        }
        if (it.uri != null && findByUriUnlocked(it.uri, it) == null) {
            try {
                ctx.getContentResolver().releasePersistableUriPermission(Uri.parse(it.uri), Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {
            }
        }
    }

    private Item findByUriUnlocked(String uri, Item except) {
        for (Item x : items) if (x != except && uri.equals(x.uri)) return x;
        return null;
    }

    private void save() {
        JSONArray a = new JSONArray();
        try {
            for (Item it : items) a.put(it.toJson(true));
        } catch (JSONException ignored) {
        }
        prefs.edit().putString("items", a.toString()).apply();
    }
}
