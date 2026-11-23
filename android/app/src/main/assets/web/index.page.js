/* Skrypt strony index.html (wydzielony z HTML – Content-Security-Policy blokuje skrypty inline). */
  'use strict';
  const COLORS = { pdf: '#e0483b', docx: '#2b67d1', odt: '#1d8bd0', sheet: '#1e9a57', csv: '#139a8f', text: '#6b7486', xml: '#d9822b', zip: '#a0702a', image: '#8b5cf6', heic: '#8b5cf6', eml: '#5b6b85', md: '#6b7486', html: '#e66a2c', epub: '#1d8bd0', rtf: '#2b67d1', pptx: '#d24726', odp: '#d24726', dxf: '#d9822b', unsupported: '#8a93a3' };
  const FORMATS = [['PDF', 'pdf'], ['DOCX', 'docx'], ['ODT', 'odt'], ['XLSX', 'sheet'], ['XLS', 'sheet'], ['ODS', 'sheet'], ['PPTX', 'pptx'], ['ODP', 'odp'], ['CSV', 'csv'], ['XML / e-faktury', 'xml'], ['ZIP', 'zip'], ['EML', 'text'], ['EPUB', 'odt'], ['RTF', 'docx'], ['MD', 'text'], ['HTML', 'text'], ['DXF', 'xml'], ['TXT', 'text'], ['JPG/PNG/HEIC', 'image']];

  UI.bar({
    home: true,
    menu: () => [
      { icon: 'trash', label: 'Wyczyść listę ostatnich', onClick: clearAll },
      { icon: 'info', label: 'O aplikacji', onClick: about },
    ],
  });

  const openBtn = document.getElementById('openBtn');
  openBtn.innerHTML = icon('folder') + 'Otwórz plik';
  openBtn.onclick = () => (Bridge ? Bridge.pickFile() : UI.toast('Wybór pliku działa w aplikacji'));
  document.getElementById('formats').append(...FORMATS.map(([t, k]) => h('span', { text: t, style: `background:${COLORS[k]}` })));
  if (Bridge && Bridge.version) document.getElementById('ver').textContent = 'Czytnik plików ' + Bridge.version();

  function when(ts) {
    const d = new Date(ts), now = new Date();
    const hm = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff === 0) return 'dziś, ' + hm;
    if (diff === 1) return 'wczoraj, ' + hm;
    const opt = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== now.getFullYear()) opt.year = 'numeric';
    return d.toLocaleDateString('pl-PL', opt) + ', ' + hm;
  }

  function badgeText(item) {
    const ext = (item.name.includes('.') ? item.name.split('.').pop() : item.type).toUpperCase();
    return ext.length > 4 ? ext.slice(0, 4) : ext;
  }

  function render() {
    let items = [];
    try { items = Bridge ? JSON.parse(Bridge.recents()) : UI.store.get('demoRecents', []); } catch (e) { items = []; }
    const list = document.getElementById('list');
    list.innerHTML = '';
    document.getElementById('cnt').textContent = items.length ? `(${items.length})` : '';
    if (!items.length) {
      list.append(h('div', { class: 'empty', html:
        'Tu pojawią się otwierane pliki.<br><br>Załączniki z Gmaila, pliki z Dysku Google czy z menedżera plików ' +
        'możesz też otwierać bezpośrednio: <b>Otwórz za pomocą → Czytnik plików</b>.' }));
      return;
    }
    const box = h('div', { class: 'recent' });
    for (const it of items) {
      const meta = [it.size ? UI.formatSize(it.size) : null, it.time ? when(it.time) : null].filter(Boolean).join(' · ');
      box.append(h('div', { class: 'row', onclick: (e) => { if (!e.target.closest('.ibtn')) Bridge && Bridge.openRecent(it.id); } },
        h('div', { class: 'badge', style: `background:${COLORS[it.type] || COLORS.unsupported}`, text: badgeText(it) }),
        h('div', { class: 't' }, h('div', { class: 'nm', text: it.name }), h('div', { class: 'meta', text: meta })),
        h('button', { class: 'ibtn', 'aria-label': 'Usuń z listy', html: icon('close'), onclick: () => { Bridge && Bridge.removeRecent(it.id); render(); } })));
    }
    list.append(box);
  }

  function clearAll() {
    UI.dialog({
      title: 'Wyczyścić listę?',
      body: 'Lista ostatnio otwieranych plików zostanie wyczyszczona. Same pliki nie zostaną usunięte.',
      buttons: [{ label: 'Anuluj' }, { label: 'Wyczyść', primary: true, action: () => { Bridge && Bridge.clearRecents(); render(); } }],
    });
  }

  function about() {
    UI.dialog({
      title: 'Czytnik plików',
      body: h('div', { html:
        'Przeglądarka dokumentów działająca bez internetu – pliki nie są nigdzie wysyłane.<br><br>' +
        '<b>Dokumenty:</b> PDF, Word (DOCX), RTF, OpenDocument (ODT), e-booki EPUB, Markdown, HTML.<br>' +
        '<b>Arkusze:</b> Excel (XLSX, XLSM, XLSB, XLS), ODS, CSV.<br>' +
        '<b>Prezentacje:</b> PowerPoint (PPTX), ODP.<br>' +
        '<b>Inne:</b> XML i e-faktury KSeF, archiwa ZIP, e-maile EML, rysunki DXF, pliki tekstowe, zdjęcia (także HEIC).<br><br>' +
        '<span style="color:var(--muted);font-size:13px">Wykorzystuje biblioteki open source: pdf.js (Mozilla), docx-preview, SheetJS, JSZip, DOMPurify, marked, dxf-parser.</span>' }),
      buttons: [{ label: 'Licencje', action: licenses }, { label: 'OK', primary: true }],
    });
  }

  /** Pełne teksty licencji bibliotek open source (wymagane przez Apache 2.0 i MIT). */
  async function licenses() {
    let text;
    try {
      const r = await fetch('lib/THIRD_PARTY_LICENSES.txt');
      if (!r.ok) throw new Error(String(r.status));
      text = await r.text();
    } catch (e) {
      UI.toast('Nie udało się wczytać licencji');
      return;
    }
    // okno „O aplikacji” zamyka się po kliknięciu przycisku – licencje otwieramy zaraz po nim
    setTimeout(() => UI.dialog({
      title: 'Licencje open source',
      body: h('pre', { class: 'lic', text }),
      buttons: [{ label: 'Zamknij', primary: true }],
    }), 0);
  }

  window.onRecentsChanged = render;
  window.showOpening = (name) => UI.loading(name ? `Otwieranie „${name}”…` : 'Otwieranie…');
  render();
  if (Q.get('opening') != null) window.showOpening(Q.get('opening'));
