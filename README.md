# Czytnik plików

Prosta aplikacja na Androida do **przeglądania** dokumentów – działa bez internetu,
pliki nie są nigdzie wysyłane.

**Pobierz APK:** https://github.com/zooolw-sudo/czytnik-plikow/releases/latest/download/czytnik-plikow.apk
(Android 8.0 lub nowszy; każda zmiana w gałęzi `main` buduje nową wersję automatycznie).

## Co otwiera

| Format | Jak wygląda |
|---|---|
| **PDF** | strony jak w oryginale, powiększanie dwoma palcami, szukanie w tekście, spis treści, przejście do strony, PDF z hasłem |
| **Word (DOCX)** | widok strony (jak w Wordzie, z nagłówkiem i stopką) albo widok do czytania (tekst zawija się do ekranu) |
| **OpenDocument tekst (ODT)** | jak DOCX – własny konwerter: style, listy, tabele, obrazy, przypisy, podział na strony |
| **Excel (XLSX, XLSM, XLSB, XLS), ODS** | siatka z literami kolumn i numerami wierszy, zakładki arkuszy, scalone komórki, podgląd formuły po stuknięciu w komórkę, polski zapis liczb i dat |
| **CSV** | jak arkusz; samo rozpoznaje kodowanie (UTF-8 / Windows-1250) i separator (`;` `,` tab) |
| **Tekst** (TXT, JSON, XML, LOG…) | zawijanie wierszy, czcionka stała, zmiana kodowania, formatowanie JSON |
| **Obrazy** (JPG, PNG, GIF, WEBP) | dopasowanie do ekranu, powiększanie |

Nieobsługiwane (z jasnym komunikatem i przyciskiem „Otwórz w innej aplikacji”): stary `.doc`, prezentacje, pliki zaszyfrowane hasłem (Office).

## Jak się z niej korzysta

- **Otwórz plik** – wybór pliku z telefonu, Dysku Google, Pobranych itd.
- **Otwórz za pomocą → Czytnik plików** – prosto z Gmaila, menedżera plików, WhatsAppa.
- **Ostatnio otwierane** – lista na ekranie startowym. Pliki otwarte z innych aplikacji są zapamiętywane jako kopia (dostęp do oryginału wygasa), większe niż 150 MB – nie.
- Menu **⋮**: udostępnij, otwórz w innej aplikacji (np. do edycji), informacje o pliku.

## Budowa

- `android/app/src/main/java/pl/zooolw/czytnik/` – część Android (Java, bez bibliotek):
  ekran z WebView, rozpoznawanie typu pliku po zawartości, lista ostatnich, udostępnianie.
- `android/app/src/main/assets/web/` – przeglądarki (HTML/JS), po jednej na rodzaj pliku.
  Plik podawany jest stronie pod adresem `https://appassets.androidplatform.net/file/…`
  bezpośrednio z telefonu; dokumenty nie mogą niczego pobierać z internetu.
- `.github/workflows/android.yml` – budowanie APK na GitHubie.

### Biblioteki (open source, w `assets/web/lib`)

- [pdf.js](https://github.com/mozilla/pdf.js) 6.5 (Mozilla, Apache 2.0) – PDF
- [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) 0.4 (Apache 2.0) – DOCX
- [SheetJS CE](https://sheetjs.com) 0.20.3 (Apache 2.0) – arkusze
- [JSZip](https://stuk.github.io/jszip/) 3.10 (MIT) – archiwa ZIP (DOCX/ODT)
