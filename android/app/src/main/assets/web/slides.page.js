/* Skrypt strony slides.html (wydzielony z HTML – Content-Security-Policy blokuje skrypty inline). */
  'use strict';
  const main = document.getElementById('main');
  const deck = document.getElementById('deck');
  const isOdp = FILE.type === 'odp';
  let P = null, notesOn = UI.store.get('slideNotes', false), finder = null, search = null, fitZ = 1;

  const zp = new ZoomPane(main, deck, { min: 0.05, max: 6, fit: () => fitZ, onChange: (z) => relabel(z) });

  /** Etykiety i notatki mają stały rozmiar mimo powiększenia slajdów. */
  function relabel(z) {
    for (const n of deck.querySelectorAll('.num')) n.style.fontSize = (12.5 / z) + 'px';
    for (const n of deck.querySelectorAll('.notes')) { n.style.fontSize = (14.5 / z) + 'px'; n.style.padding = `${8 / z}px ${12 / z}px`; }
  }

  function fit() {
    fitZ = Math.min(4, (main.clientWidth - 20) / P.width);
    return fitZ;
  }

  function currentSlide() {
    const top = main.getBoundingClientRect().top + main.clientHeight * 0.3;
    let idx = 0;
    deck.querySelectorAll('.sw').forEach((s, i) => { if (s.getBoundingClientRect().top <= top) idx = i; });
    return idx;
  }

  let t = null;
  main.addEventListener('scroll', () => {
    clearTimeout(t);
    t = setTimeout(() => { if (P) UI.setSub(`Slajd ${currentSlide() + 1} z ${P.slides.length}`, gotoSlide); }, 120);
  });

  async function gotoSlide() {
    const v = await UI.prompt({
      title: 'Przejdź do slajdu', label: `Numer slajdu (1–${P.slides.length})`, type: 'number', value: String(currentSlide() + 1), okLabel: 'Przejdź',
      validate: (s) => (Number(s) >= 1 && Number(s) <= P.slides.length ? null : `Wpisz liczbę od 1 do ${P.slides.length}`),
    });
    if (v != null) deck.children[Number(v) - 1].scrollIntoView({ block: 'start' });
  }

  function slideShow(start) {
    let i = start;
    const ov = h('div', { class: 'show' });
    const cnt = h('div', { class: 'cnt' });
    let pop;
    const close = () => { ov.remove(); pop(); };
    pop = UI.pushOverlay(close);
    const draw = () => {
      ov.querySelectorAll('.slide').forEach((s) => s.remove());
      const s = P.slides[i].el.cloneNode(true);
      s.style.zoom = Math.min(window.innerWidth / P.width, window.innerHeight / P.height);
      ov.prepend(s);
      cnt.textContent = `${i + 1} / ${P.slides.length}`;
    };
    let sx = null;
    ov.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    ov.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) { i = Math.max(0, Math.min(P.slides.length - 1, i + (dx < 0 ? 1 : -1))); draw(); }
    });
    ov.addEventListener('click', (e) => {
      i = Math.max(0, Math.min(P.slides.length - 1, i + (e.clientX > window.innerWidth / 2 ? 1 : -1)));
      draw();
    });
    window.addEventListener('resize', draw);
    ov.append(cnt);
    document.body.append(ov);
    draw();
    UI.toast('Stuknij z prawej – dalej, z lewej – wstecz. Wstecz zamyka pokaz.', 3000);
  }

  UI.bar({
    actions: [
      { icon: 'search', label: 'Szukaj', onClick: () => {
        finder = UI.find({
          placeholder: 'Szukaj na slajdach',
          onSearch: (q) => { const n = search.run(q); finder.count(n ? 1 : 0, n); },
          onNext: () => { search.next(); finder.count(search.cur + 1, search.hits.length); },
          onPrev: () => { search.prev(); finder.count(search.cur + 1, search.hits.length); },
          onClose: () => { search.clear(); finder = null; },
        });
      } },
    ],
    menu: () => {
      const m = [{ icon: 'openWith', label: 'Pokaz slajdów', onClick: () => slideShow(currentSlide()) },
        { icon: 'goto', label: 'Przejdź do slajdu…', onClick: gotoSlide }];
      if (P && P.slides.some((s) => s.notes)) m.push({ icon: 'text', label: 'Notatki prelegenta', checked: notesOn, onClick: toggleNotes });
      m.push({ icon: 'fit', label: 'Dopasuj do ekranu', onClick: () => zp.setZoom(fit(), 0, 0) });
      return m;
    },
  });

  function toggleNotes() {
    notesOn = !notesOn;
    UI.store.set('slideNotes', notesOn);
    deck.querySelectorAll('.notes').forEach((n) => { n.hidden = !notesOn || !n.textContent; });
  }

  window.addEventListener('resize', () => { if (P) { const rel = zp.zoom / fitZ; zp.setZoom(fit() * rel, 0, 0); } });

  (async () => {
    UI.loading('Otwieranie prezentacji…');
    try {
      const data = await UI.fetchFile();
      UI.loading('Układam slajdy…');
      P = isOdp ? await Odp.load(data, (f) => UI.progress(f)) : await Pptx.load(data, (f) => UI.progress(f));
      if (!P.slides.length) throw new Error('Prezentacja nie zawiera slajdów');
      P.slides.forEach((s, i) => {
        const w = h('div', { class: 'sw' + (s.hidden ? ' hid' : '') },
          h('div', { class: 'num', text: `${i + 1}${s.hidden ? ' · ukryty' : ''}` }), s.el,
          h('div', { class: 'notes', text: s.notes || '', hidden: !notesOn || !s.notes, style: `width:${P.width}px;box-sizing:border-box` }));
        deck.append(w);
      });
      search = new DomSearch(deck, main);
      zp.setZoom(fit(), 0, 0);
      UI.done();
      UI.setSub(`${isOdp ? 'Prezentacja ODP' : 'Prezentacja PowerPoint'} · ${P.slides.length} ${plPlural(P.slides.length, 'slajd', 'slajdy', 'slajdów')}`, gotoSlide);
      UI.extraInfo = () => [['Slajdy', String(P.slides.length)], ['Rozmiar slajdu', `${Math.round(P.width)} × ${Math.round(P.height)} px`]];
    } catch (e) {
      console.error(e);
      UI.fail('Nie udało się otworzyć prezentacji', String(e && e.message || e));
    }
  })();
