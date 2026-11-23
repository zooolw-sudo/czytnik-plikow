/* Skrypt strony text.html (wydzielony z HTML – Content-Security-Policy blokuje skrypty inline). */
  'use strict';
  const LIMIT = 4000000;
  const main = document.getElementById('main');
  const box = document.getElementById('box');
  const pre = document.getElementById('txt');
  const ext = (FILE.name.split('.').pop() || '').toLowerCase();
  const codeLike = ['json', 'xml', 'log', 'csv', 'tsv', 'ini', 'cfg', 'conf', 'yaml', 'yml', 'js', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'ino', 'sql', 'sh', 'bat', 'html', 'css', 'gcode', 'nc'].includes(ext);
  let raw = null, enc = null, pretty = ext === 'json';
  let opts = UI.store.get('textOpts', { wrap: true, mono: null });
  const search = new DomSearch(pre, main);
  const zp = new ZoomPane(main, box, { min: 0.4, max: 4, fit: () => 1 });
  let finder = null;

  function apply() {
    pre.classList.toggle('nowrap', !opts.wrap);
    pre.classList.toggle('mono', opts.mono == null ? codeLike : opts.mono);
  }

  function show() {
    if (finder) finder.close();
    const r = decodeText(raw, enc);
    enc = r.enc;
    let text = r.text;
    if (pretty && ext === 'json') {
      try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* zostaw jak jest */ }
    }
    const cut = text.length > LIMIT;
    pre.textContent = cut ? text.slice(0, LIMIT) : text;
    const old = box.querySelector('.cut');
    if (old) old.remove();
    if (cut) box.append(h('div', { class: 'cut', text: `Pokazano pierwsze ${LIMIT.toLocaleString('pl-PL')} znaków z ${text.length.toLocaleString('pl-PL')}. Cały plik otworzysz w innej aplikacji.` }));
    const lines = (text.match(/\n/g) || []).length + 1;
    UI.setSub(`${lines.toLocaleString('pl-PL')} ${plPlural(lines, 'wiersz', 'wiersze', 'wierszy')} · ${encodingLabel(enc)}`);
    apply();
  }

  UI.bar({
    actions: [{ icon: 'search', label: 'Szukaj', onClick: () => {
      finder = UI.find({
        placeholder: 'Szukaj w tekście',
        onSearch: (q) => { const n = search.run(q); finder.count(n ? 1 : 0, n); },
        onNext: () => { search.next(); finder.count(search.cur + 1, search.hits.length); },
        onPrev: () => { search.prev(); finder.count(search.cur + 1, search.hits.length); },
        onClose: () => { search.clear(); finder = null; },
      });
    } }],
    menu: () => {
      const m = [
        { icon: 'wrap', label: 'Zawijaj wiersze', checked: opts.wrap, onClick: () => { opts.wrap = !opts.wrap; UI.store.set('textOpts', opts); apply(); } },
        { icon: 'text', label: 'Czcionka o stałej szerokości', checked: pre.classList.contains('mono'), onClick: () => { opts.mono = !pre.classList.contains('mono'); UI.store.set('textOpts', opts); apply(); } },
        { icon: 'toc', label: 'Kodowanie znaków…', onClick: () => chooseEncoding(enc, (e) => { enc = e; show(); }) },
      ];
      if (ext === 'json') m.push({ icon: 'fit', label: 'Formatuj JSON', checked: pretty, onClick: () => { pretty = !pretty; show(); } });
      return m;
    },
  });

  (async () => {
    UI.loading('Otwieranie…');
    try {
      raw = await UI.fetchFile();
      show();
      UI.done();
    } catch (e) {
      UI.fail('Nie udało się otworzyć pliku', String(e && e.message || e));
    }
  })();
