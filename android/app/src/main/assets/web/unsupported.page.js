/* Skrypt strony unsupported.html (wydzielony z HTML – Content-Security-Policy blokuje skrypty inline). */
  'use strict';
  const MSG = {
    doc: ['Stary format Word (.doc)', 'Ten czytnik pokazuje dokumenty Word w nowym formacie DOCX. Stary format .doc otwórz w innej aplikacji albo zapisz go w Wordzie jako DOCX.'],
    ppt: ['Stary format PowerPoint (.ppt)', 'Czytnik pokazuje prezentacje PPTX i ODP. Stary format .ppt otwórz w innej aplikacji albo zapisz go w PowerPoincie jako PPTX.'],
    encrypted: ['Plik chroniony hasłem', 'Ten dokument Office jest zaszyfrowany hasłem. Czytnik nie otwiera zaszyfrowanych plików Word/Excel.'],
    archive: ['Archiwum RAR / 7z', 'Czytnik otwiera archiwa ZIP. Archiwa RAR i 7z rozpakuj w menedżerze plików.'],
    msg: ['Wiadomość Outlook (.msg)', 'Format .msg z Outlooka nie jest obsługiwany. W Outlooku zapisz wiadomość jako .eml albo przekaż ją e-mailem.'],
    heic: ['Zdjęcie HEIC', 'Zdjęcia HEIC/HEIF (np. z iPhone’a) czytnik pokazuje na Androidzie 9 lub nowszym. Na tym urządzeniu otwórz je w galerii.'],
    dwg: ['Rysunek DWG', 'DWG to zamknięty format AutoCADa. Zapisz rysunek jako DXF (np. w AutoCAD, DraftSight lub LibreCAD) – czytnik pokaże go z warstwami.'],
    odf: ['Plik OpenDocument', 'Ten rodzaj pliku OpenDocument (np. rysunek ODG lub formuła) nie jest obsługiwany. Czytnik otwiera dokumenty ODT, arkusze ODS i prezentacje ODP.'],
    unknown: ['Nieznany typ pliku', 'Czytnik nie rozpoznał tego pliku. Obsługiwane są m.in.: PDF, DOCX, ODT, RTF, XLSX, XLS, ODS, CSV, PPTX, ODP, XML (e-faktury KSeF), ZIP, EML, EPUB, Markdown, HTML, DXF, pliki tekstowe i zdjęcia (także HEIC).'],
  };
  const [title, msg] = MSG[Q.get('reason')] || MSG.unknown;
  UI.bar({});
  UI.fail(title, msg, { icon: Q.get('reason') === 'encrypted' ? 'lock' : 'file' });
