/*
 * Wspólna obsługa dokumentów tekstowych (DOCX i ODT): wczytanie pliku, przełączanie
 * widoku strony / widoku do czytania, powiększanie i szukanie.
 */
'use strict';

const DocView = {
  start({ label, render }) {
    const scroller = document.getElementById('main');
    const el = document.getElementById('doc');
    let mode = UI.store.get('docMode', 'page');
    let data = null, pages = 0, natural = 0, lastFit = 1;
    const search = new DomSearch(el, scroller);
    let finder = null;

    const fit = () => (mode === 'read' ? 1 : (natural ? Math.min(1.5, (scroller.clientWidth - 2) / natural) : 1));
    const zp = new ZoomPane(scroller, el, { min: 0.15, max: 6, fit });

    UI.bar({
      actions: [
        { icon: 'search', label: 'Szukaj', onClick: openFind },
        { icon: mode === 'read' ? 'page' : 'text', label: 'Zmień widok', id: 'modeBtn', onClick: () => setMode(mode === 'read' ? 'page' : 'read') },
      ],
      menu: () => [
        { icon: 'page', label: 'Widok strony', checked: mode === 'page', onClick: () => setMode('page') },
        { icon: 'text', label: 'Widok do czytania', checked: mode === 'read', onClick: () => setMode('read') },
        { icon: 'fit', label: 'Dopasuj do ekranu', onClick: () => zp.setZoom(fit(), 0, 0) },
      ],
    });

    function updateSub() {
      if (mode === 'read') UI.setSub(label + ' · widok do czytania');
      else UI.setSub(label + (pages > 1 ? ` · ${pages} ${plPlural(pages, 'strona', 'strony', 'stron')}` : ''));
    }

    async function draw() {
      if (finder) finder.close();
      el.innerHTML = '';
      el.className = mode === 'read' ? 'reading' : 'paged';
      document.body.classList.toggle('reading', mode === 'read');
      el.style.zoom = 1;
      zp.zoom = 1;
      pages = await render(data, el, mode);
      natural = el.scrollWidth;
      lastFit = fit();
      zp.setZoom(lastFit, 0, 0);
      scroller.scrollTop = 0;
      scroller.scrollLeft = 0;
      updateSub();
      const b = document.getElementById('modeBtn');
      if (b) {
        b.innerHTML = icon(mode === 'read' ? 'page' : 'text');
        b.title = mode === 'read' ? 'Widok strony' : 'Widok do czytania';
      }
    }

    async function setMode(m) {
      if (m === mode) return;
      mode = m;
      UI.store.set('docMode', m);
      UI.loading(m === 'read' ? 'Przygotowuję widok do czytania…' : 'Układam strony…');
      await new Promise((r) => setTimeout(r, 30));
      try { await draw(); UI.done(); } catch (e) { console.error(e); UI.fail('Nie udało się zmienić widoku', String(e && e.message || e)); }
    }

    function openFind() {
      finder = UI.find({
        placeholder: 'Szukaj w dokumencie',
        onSearch: (q) => { const n = search.run(q); finder.count(n ? 1 : 0, n); },
        onNext: () => { search.next(); finder.count(search.cur + 1, search.hits.length); },
        onPrev: () => { search.prev(); finder.count(search.cur + 1, search.hits.length); },
        onClose: () => { search.clear(); finder = null; },
      });
    }

    window.addEventListener('resize', () => {
      if (!data) return;
      const rel = zp.zoom / lastFit;
      lastFit = fit();
      zp.setZoom(lastFit * rel, 0, 0);
    });

    UI.extraInfo = () => (pages ? [['Strony', mode === 'read' ? '—' : `${pages} (w przybliżeniu)`]] : []);

    (async () => {
      UI.loading('Otwieranie dokumentu…');
      try {
        data = await UI.fetchFile();
        UI.loading('Układam strony…');
        await new Promise((r) => setTimeout(r, 20));
        await draw();
        UI.done();
      } catch (e) {
        console.error(e);
        const msg = String(e && e.message || e);
        if (/password|encrypt|zaszyfr|hasł/i.test(msg)) UI.fail('Plik chroniony hasłem', 'Tego dokumentu nie da się otworzyć bez hasła.', { icon: 'lock' });
        else UI.fail('Nie udało się otworzyć dokumentu', 'Plik może być uszkodzony albo w nieobsługiwanym wariancie formatu. (' + msg + ')');
      }
    })();
  },
};
