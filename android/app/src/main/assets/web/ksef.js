/*
 * Widok e-faktury z Krajowego Systemu e-Faktur (struktury FA(2) i FA(3)):
 * sprzedawca, nabywca, pozycje, podsumowanie VAT, płatność, adnotacje, stopka.
 * Plik XML pozostaje dostępny w zakładce „XML”.
 */
'use strict';

const Ksef = (() => {
  const kid = (el, name) => (el ? Array.from(el.children).find((c) => c.localName === name) || null : null);
  const kids = (el, name) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
  const path = (el, ...names) => { for (const n of names) { el = kid(el, n); if (!el) return null; } return el; };
  const txt = (el, ...names) => { const e = names.length ? path(el, ...names) : el; return e ? e.textContent.trim() : ''; };

  let cur = 'PLN';
  const num = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const money = (v, c = cur) => {
    const n = num(v);
    if (n == null || v === '') return '';
    return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (c === 'PLN' ? 'zł' : c);
  };
  const qty = (v) => { const n = num(v); return n == null ? v : n.toLocaleString('pl-PL', { maximumFractionDigits: 6 }); };
  const date = (v) => {
    if (!v) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v);
    if (!m) return v;
    let s = `${m[3]}.${m[2]}.${m[1]}`;
    if (m[4]) {
      const d = new Date(v);
      s = isNaN(d) ? s + ` ${m[4]}:${m[5]}` : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    return s;
  };
  const account = (v) => {
    const s = v.replace(/\s/g, '');
    if (/^\d{26}$/.test(s)) return s.slice(0, 2) + ' ' + s.slice(2).replace(/(\d{4})(?=\d)/g, '$1 ');
    return s.replace(/(.{4})(?=.)/g, '$1 ');
  };

  const RODZAJ = {
    VAT: 'Faktura VAT', KOR: 'Faktura korygująca', ZAL: 'Faktura zaliczkowa', ROZ: 'Faktura rozliczeniowa',
    UPR: 'Faktura uproszczona', KOR_ZAL: 'Korekta faktury zaliczkowej', KOR_ROZ: 'Korekta faktury rozliczeniowej',
  };
  const ROLA = {
    1: 'Faktor', 2: 'Odbiorca', 3: 'Podmiot pierwotny', 4: 'Dodatkowy nabywca', 5: 'Wystawca faktury',
    6: 'Dokonujący płatności', 7: 'JST – wystawca', 8: 'JST – odbiorca', 9: 'Członek grupy VAT – wystawca',
    10: 'Członek grupy VAT – odbiorca', 11: 'Pracownik',
  };
  const FORMA = { 1: 'gotówka', 2: 'karta', 3: 'bon', 4: 'czek', 5: 'kredyt', 6: 'przelew', 7: 'płatność mobilna' };
  const STAWKA = {
    '0 KR': '0% (kraj)', '0 WDT': '0% WDT', '0 EX': '0% eksport', zw: 'zw.', oo: 'odwr. obc.',
    'np I': 'np.', 'np II': 'np. (art. 100)',
  };
  const VAT_ROWS = [
    ['P_13_1', 'P_14_1', '23% / 22%'], ['P_13_2', 'P_14_2', '8% / 7%'], ['P_13_3', 'P_14_3', '5%'],
    ['P_13_4', 'P_14_4', '4% / 3% (taxi)'], ['P_13_5', 'P_14_5', 'procedura OSS'], ['P_13_6_1', null, '0% (kraj)'],
    ['P_13_6_2', null, '0% WDT'], ['P_13_6_3', null, '0% eksport'], ['P_13_7', null, 'zwolnione'],
    ['P_13_8', null, 'np. (poza krajem)'], ['P_13_9', null, 'np. (art. 100 ust. 1 pkt 4)'],
    ['P_13_10', null, 'odwrotne obciążenie'], ['P_13_11', null, 'marża'],
  ];

  function copy(text, label) {
    if (Bridge && Bridge.copy) { Bridge.copy(text); UI.toast(label + ' skopiowany'); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => UI.toast(label + ' skopiowany'), () => {});
  }

  const card = (title, ...content) => h('section', { class: 'card' }, title ? h('h3', { text: title }) : null, ...content);
  const kv = (rows) => {
    const dl = h('dl', { class: 'kv' });
    for (const [k, v] of rows) if (v) dl.append(h('dt', { text: k }), h('dd', null, v));
    return dl.childNodes.length ? dl : null;
  };

  function party(el, title) {
    if (!el) return null;
    const di = kid(el, 'DaneIdentyfikacyjne');
    const ids = [];
    if (txt(di, 'NIP')) ids.push('NIP ' + txt(di, 'NIP'));
    if (txt(di, 'NrVatUE')) ids.push('VAT UE ' + txt(di, 'KodUE') + txt(di, 'NrVatUE'));
    if (txt(di, 'NrID')) ids.push((txt(di, 'KodKraju') ? txt(di, 'KodKraju') + ' ' : '') + txt(di, 'NrID'));
    if (kid(di, 'BrakID')) ids.push('bez identyfikatora podatkowego');
    const c = card(title, h('div', { class: 'nm', text: txt(di, 'Nazwa') || '—' }));
    if (ids.length) c.append(h('div', { class: 'ids', text: ids.join(' · ') }));
    const adr = kid(el, 'Adres');
    if (adr) {
      const lines = [txt(adr, 'AdresL1'), txt(adr, 'AdresL2')].filter(Boolean);
      const kraj = txt(adr, 'KodKraju');
      if (kraj && kraj !== 'PL') lines.push(kraj);
      c.append(h('div', { class: 'adr', text: lines.join('\n') }));
    }
    const kor = kid(el, 'AdresKoresp');
    if (kor) c.append(h('div', { class: 'small', text: 'Adres do korespondencji: ' + [txt(kor, 'AdresL1'), txt(kor, 'AdresL2')].filter(Boolean).join(', ') }));
    for (const dk of kids(el, 'DaneKontaktowe')) {
      const parts = [txt(dk, 'Telefon'), txt(dk, 'Email')].filter(Boolean);
      if (parts.length) c.append(h('div', { class: 'small', text: parts.join(' · ') }));
    }
    const extra = [];
    if (txt(el, 'NrKlienta')) extra.push('Nr klienta: ' + txt(el, 'NrKlienta'));
    if (txt(el, 'NrEORI')) extra.push('EORI: ' + txt(el, 'NrEORI'));
    if (txt(el, 'IDNabywcy')) extra.push('ID nabywcy: ' + txt(el, 'IDNabywcy'));
    if (txt(el, 'Udzial')) extra.push('Udział: ' + txt(el, 'Udzial') + '%');
    if (extra.length) c.append(h('div', { class: 'small', text: extra.join(' · ') }));
    return c;
  }

  function positions(fa) {
    const rows = kids(fa, 'FaWiersz');
    if (!rows.length) return null;
    const c = card(`Pozycje (${rows.length})`);
    for (const w of rows) {
      const nr = txt(w, 'NrWierszaFa');
      const name = txt(w, 'P_7') || '(bez nazwy)';
      const unit = txt(w, 'P_8A');
      const q = txt(w, 'P_8B');
      const netP = txt(w, 'P_9A'), grossP = txt(w, 'P_9B');
      const netV = txt(w, 'P_11'), grossV = txt(w, 'P_11A');
      const st = txt(w, 'P_12');
      const pos = h('div', { class: 'pos' + (txt(w, 'StanPrzed') === '1' ? ' before' : '') });
      pos.append(h('div', { class: 't' }, nr ? h('span', { class: 'nr', text: nr + '.' }) : null, name));
      const left = [];
      if (q) left.push(`${qty(q)}${unit ? ' ' + unit : ''}`);
      if (netP) left.push('× ' + money(netP) + ' netto');
      else if (grossP) left.push('× ' + money(grossP) + ' brutto');
      if (txt(w, 'P_10')) left.push('rabat ' + money(txt(w, 'P_10')));
      const right = netV ? money(netV) + ' netto' : grossV ? money(grossV) + ' brutto' : '';
      pos.append(h('div', { class: 'calc' }, h('span', { text: left.join(' ') }), h('b', { text: right })));
      const meta = [];
      if (st) meta.push('VAT ' + (STAWKA[st] || st + '%'));
      if (txt(w, 'P_11Vat')) meta.push('kwota VAT ' + money(txt(w, 'P_11Vat')));
      if (txt(w, 'Indeks')) meta.push('indeks ' + txt(w, 'Indeks'));
      if (txt(w, 'GTIN')) meta.push('GTIN ' + txt(w, 'GTIN'));
      if (txt(w, 'PKWiU')) meta.push('PKWiU ' + txt(w, 'PKWiU'));
      if (txt(w, 'CN')) meta.push('CN ' + txt(w, 'CN'));
      if (txt(w, 'GTU')) meta.push(txt(w, 'GTU'));
      if (txt(w, 'P_6A')) meta.push('data ' + date(txt(w, 'P_6A')));
      if (txt(w, 'StanPrzed') === '1') meta.push('stan przed korektą');
      if (meta.length) pos.append(h('div', { class: 'meta', text: meta.join(' · ') }));
      c.append(pos);
    }
    return c;
  }

  function vatSummary(fa) {
    const t = h('table', { class: 'vat' }, h('thead', null, h('tr', null,
      h('th', { text: 'Stawka' }), h('th', { text: 'Netto' }), h('th', { text: 'VAT' }), h('th', { text: 'Brutto' }))));
    const tb = h('tbody');
    let any = false, sumN = 0, sumV = 0;
    for (const [n, v, label] of VAT_ROWS) {
      const nv = txt(fa, n);
      if (!nv) continue;
      any = true;
      const vv = v ? txt(fa, v) : '';
      const nn = num(nv) || 0, vn = num(vv) || 0;
      sumN += nn; sumV += vn;
      const vw = v ? txt(fa, v + 'W') : '';
      tb.append(h('tr', null, h('td', { text: label }), h('td', { text: money(nv) }),
        h('td', { text: vv ? money(vv) + (vw ? `\n(${money(vw, 'PLN')})` : '') : '—' }), h('td', { text: money(nn + vn) })));
    }
    if (!any) return null;
    tb.append(h('tr', { class: 'sum' }, h('td', { text: 'Razem' }), h('td', { text: money(sumN) }), h('td', { text: money(sumV) }), h('td', { text: money(sumN + sumV) })));
    t.append(tb);
    return card('Podsumowanie VAT', h('div', { class: 'tblwrap' }, t));
  }

  function annotations(fa) {
    const a = kid(fa, 'Adnotacje');
    if (!a) return null;
    const flags = [];
    if (txt(a, 'P_16') === '1') flags.push('Metoda kasowa');
    if (txt(a, 'P_17') === '1') flags.push('Samofakturowanie');
    if (txt(a, 'P_18') === '1') flags.push('Odwrotne obciążenie');
    if (txt(a, 'P_18A') === '1') flags.push('Mechanizm podzielonej płatności');
    if (txt(a, 'Zwolnienie', 'P_19') === '1') flags.push('Zwolnienie z VAT');
    if (txt(a, 'NoweSrodkiTransportu', 'P_22') === '1') flags.push('Nowe środki transportu (WDT)');
    if (txt(a, 'P_23') === '1') flags.push('Procedura trójstronna uproszczona');
    const pm = kid(a, 'PMarzy');
    if (txt(pm, 'P_PMarzy') === '1') {
      let t = 'Procedura marży';
      if (txt(pm, 'P_PMarzy_2') === '1') t += ' – biura podróży';
      if (txt(pm, 'P_PMarzy_3_1') === '1') t += ' – towary używane';
      if (txt(pm, 'P_PMarzy_3_2') === '1') t += ' – dzieła sztuki';
      if (txt(pm, 'P_PMarzy_3_3') === '1') t += ' – przedmioty kolekcjonerskie i antyki';
      flags.push(t);
    }
    if (!flags.length) return null;
    const c = card('Adnotacje', h('div', null, ...flags.map((f) => h('span', { class: 'flag', text: f }))));
    const zw = kid(a, 'Zwolnienie');
    const basis = [txt(zw, 'P_19A'), txt(zw, 'P_19B'), txt(zw, 'P_19C')].filter(Boolean);
    if (basis.length) c.append(h('div', { class: 'small', text: 'Podstawa zwolnienia: ' + basis.join('; ') }));
    return c;
  }

  function payment(fa) {
    const p = kid(fa, 'Platnosc');
    if (!p) return null;
    const c = card('Płatność');
    if (txt(p, 'Zaplacono') === '1') c.append(h('div', { class: 'paid', text: 'Zapłacono' + (txt(p, 'DataZaplaty') ? ' ' + date(txt(p, 'DataZaplaty')) : '') }));
    const rows = [];
    const terms = kids(p, 'TerminPlatnosci').map((t) => {
      let s = date(txt(t, 'Termin'));
      const op = kid(t, 'TerminOpis');
      if (op) s += (s ? ' – ' : '') + [txt(op, 'Ilosc'), txt(op, 'Jednostka'), txt(op, 'ZdarzeniePoczatkowe')].filter(Boolean).join(' ');
      return s;
    }).filter(Boolean);
    if (terms.length) rows.push(['Termin', terms.join('\n')]);
    const forma = FORMA[txt(p, 'FormaPlatnosci')] || (txt(p, 'PlatnoscInna') === '1' ? txt(p, 'OpisPlatnosci') : '');
    if (forma) rows.push(['Forma', forma]);
    for (const zc of kids(p, 'ZaplataCzesciowa')) rows.push(['Zapłata częściowa', `${money(txt(zc, 'KwotaZaplatyCzesciowej'))}, ${date(txt(zc, 'DataZaplatyCzesciowej'))}`]);
    const sk = kid(p, 'Skonto');
    if (sk) rows.push(['Skonto', [txt(sk, 'WarunkiSkonta'), txt(sk, 'WysokoscSkonta')].filter(Boolean).join(' – ')]);
    const k = kv(rows);
    if (k) c.append(k);
    for (const [tag, label] of [['RachunekBankowy', 'Rachunek'], ['RachunekBankowyFaktora', 'Rachunek faktora']]) {
      for (const rb of kids(p, tag)) {
        const nr = txt(rb, 'NrRB');
        if (!nr) continue;
        const acc = h('div', { class: 'acct' },
          h('div', { class: 'lbl', text: label + (txt(rb, 'NazwaBanku') ? ' · ' + txt(rb, 'NazwaBanku') : '') }),
          h('div', { class: 'row' }, h('span', { class: 'no', text: account(nr) }),
            h('button', { class: 'copy', text: 'Kopiuj', onclick: () => copy(nr.replace(/\s/g, ''), 'Numer konta') })));
        const ex = [txt(rb, 'SWIFT') && 'SWIFT ' + txt(rb, 'SWIFT'), txt(rb, 'OpisRachunku')].filter(Boolean);
        if (ex.length) acc.append(h('div', { class: 'lbl', text: ex.join(' · ') }));
        c.append(acc);
      }
    }
    const link = txt(p, 'LinkDoPlatnosci');
    if (link && /^https:/i.test(link)) c.append(h('a', { class: 'paylink', href: link, target: '_blank', text: 'Zapłać online' }));
    if (txt(p, 'IPKSeF')) c.append(h('div', { class: 'small', text: 'Identyfikator płatności KSeF: ' + txt(p, 'IPKSeF') }));
    return c.childNodes.length > 1 ? c : null;
  }

  function settlement(fa) {
    const r = kid(fa, 'Rozliczenie');
    if (!r) return null;
    const rows = [];
    for (const o of kids(r, 'Obciazenia')) rows.push(['Obciążenie', `${money(txt(o, 'Kwota'))} – ${txt(o, 'Powod')}`]);
    for (const o of kids(r, 'Odliczenia')) rows.push(['Odliczenie', `${money(txt(o, 'Kwota'))} – ${txt(o, 'Powod')}`]);
    if (txt(r, 'DoZaplaty')) rows.push(['Do zapłaty', money(txt(r, 'DoZaplaty'))]);
    if (txt(r, 'DoRozliczenia')) rows.push(['Do rozliczenia', money(txt(r, 'DoRozliczenia'))]);
    const k = kv(rows);
    return k ? card('Rozliczenie', k) : null;
  }

  function correction(fa) {
    const rows = [];
    if (txt(fa, 'PrzyczynaKorekty')) rows.push(['Przyczyna', txt(fa, 'PrzyczynaKorekty')]);
    const typ = { 1: 'w dacie faktury pierwotnej', 2: 'w dacie wystawienia korekty', 3: 'w innej dacie' }[txt(fa, 'TypKorekty')];
    if (typ) rows.push(['Ujęcie korekty', typ]);
    for (const d of kids(fa, 'DaneFaKorygowanej')) {
      const nrK = txt(d, 'NrKSeFFaKorygowanej');
      rows.push(['Faktura korygowana', `${txt(d, 'NrFaKorygowanej')} z ${date(txt(d, 'DataWystFaKorygowanej'))}${nrK ? '\nKSeF: ' + nrK : ''}`]);
    }
    if (txt(fa, 'OkresFaKorygowanej')) rows.push(['Okres', txt(fa, 'OkresFaKorygowanej')]);
    const k = kv(rows);
    return k ? card('Korekta', k) : null;
  }

  function conditions(fa) {
    const w = kid(fa, 'WarunkiTransakcji');
    const rows = [];
    for (const d of kids(fa, 'DodatkowyOpis')) rows.push([txt(d, 'Klucz') || 'Opis', txt(d, 'Wartosc')]);
    if (w) {
      for (const u of kids(w, 'Umowy')) rows.push(['Umowa', [txt(u, 'NrUmowy'), date(txt(u, 'DataUmowy'))].filter(Boolean).join(' z ')]);
      for (const z of kids(w, 'Zamowienia')) rows.push(['Zamówienie', [txt(z, 'NrZamowienia'), date(txt(z, 'DataZamowienia'))].filter(Boolean).join(' z ')]);
      for (const p of kids(w, 'NrPartiiTowaru')) rows.push(['Partia towaru', txt(p)]);
      if (txt(w, 'WarunkiDostawy')) rows.push(['Warunki dostawy', txt(w, 'WarunkiDostawy')]);
    }
    for (const wz of kids(fa, 'WZ')) rows.push(['WZ', txt(wz)]);
    const k = kv(rows);
    return k ? card('Szczegóły', k) : null;
  }

  function footer(doc) {
    const s = path(doc.documentElement, 'Stopka');
    if (!s) return null;
    const c = card(null);
    for (const i of kids(s, 'Informacje')) for (const t of kids(i, 'StopkaFaktury')) c.append(h('p', { class: 'foot', text: txt(t) }));
    for (const r of kids(s, 'Rejestry')) {
      const parts = [txt(r, 'PelnaNazwa'), txt(r, 'KRS') && 'KRS ' + txt(r, 'KRS'), txt(r, 'REGON') && 'REGON ' + txt(r, 'REGON'), txt(r, 'BDO') && 'BDO ' + txt(r, 'BDO')].filter(Boolean);
      if (parts.length) c.append(h('div', { class: 'small', text: parts.join(' · ') }));
    }
    return c.childNodes.length ? c : null;
  }

  function attachment(doc) {
    const z = path(doc.documentElement, 'Zalacznik');
    if (!z) return null;
    const c = card('Załącznik do faktury');
    for (const b of kids(z, 'BlokDanych')) {
      if (txt(b, 'ZNaglowek')) c.append(h('h4', { text: txt(b, 'ZNaglowek') }));
      const md = kids(b, 'MetaDane').map((m) => [txt(m, 'ZKlucz'), txt(m, 'ZWartosc')]);
      const k = kv(md);
      if (k) c.append(k);
      for (const t of kids(b, 'Tekst')) for (const a of kids(t, 'Akapit')) c.append(h('p', { text: txt(a) }));
      for (const tab of kids(b, 'Tabela')) {
        const k2 = kv(kids(tab, 'TMetaDane').map((m) => [txt(m, 'TKlucz'), txt(m, 'TWartosc')]));
        if (k2) c.append(k2);
        if (txt(tab, 'Opis')) c.append(h('p', { class: 'small', text: txt(tab, 'Opis') }));
        const t = h('table', { class: 'vat' });
        const head = kid(tab, 'TNaglowek');
        if (head) t.append(h('thead', null, h('tr', null, ...kids(head, 'Kol').map((k3) => h('th', { text: txt(k3, 'NKom') })))));
        const tb = h('tbody');
        for (const w of kids(tab, 'Wiersz')) tb.append(h('tr', null, ...kids(w, 'WKom').map((x) => h('td', { text: txt(x) }))));
        const sum = kid(tab, 'Suma');
        if (sum) tb.append(h('tr', { class: 'sum' }, ...kids(sum, 'SKom').map((x) => h('td', { text: txt(x) }))));
        t.append(tb);
        c.append(h('div', { class: 'tblwrap' }, t));
      }
    }
    return c;
  }

  return {
    detect(doc) {
      const r = doc && doc.documentElement;
      return !!r && r.localName === 'Faktura' && /crd\.gov\.pl\/wzor\//.test(r.namespaceURI || '') && !!kid(r, 'Fa');
    },

    version(doc) {
      const k = path(doc.documentElement, 'Naglowek', 'KodFormularza');
      const sys = k && k.getAttribute('kodSystemowy');
      if (sys) return sys.replace(/\s+/g, '');
      const w = txt(doc.documentElement, 'Naglowek', 'WariantFormularza');
      return w ? `FA(${w})` : 'FA';
    },

    info(doc) {
      const r = doc.documentElement, fa = kid(r, 'Fa');
      cur = txt(fa, 'KodWaluty') || 'PLN';
      return [
        ['Faktura', txt(fa, 'P_2')],
        ['Sprzedawca', txt(r, 'Podmiot1', 'DaneIdentyfikacyjne', 'Nazwa')],
        ['Kwota', money(txt(fa, 'P_15'))],
        ['Struktura', this.version(doc)],
      ].filter((x) => x[1]);
    },

    render(doc, box) {
      const r = doc.documentElement;
      const fa = kid(r, 'Fa');
      cur = txt(fa, 'KodWaluty') || 'PLN';
      box.innerHTML = '';
      const inv = h('div', { class: 'inv' });

      // nagłówek
      const head = h('section', { class: 'inv-head' });
      head.append(h('div', { class: 'kind', text: RODZAJ[txt(fa, 'RodzajFaktury')] || 'Faktura' }));
      head.append(h('h1', { text: txt(fa, 'P_2') || '(bez numeru)' }));
      const hrows = [['Data wystawienia', [date(txt(fa, 'P_1')), txt(fa, 'P_1M')].filter(Boolean).join(', ')]];
      if (txt(fa, 'P_6')) hrows.push(['Data dostawy / wykonania', date(txt(fa, 'P_6'))]);
      const okres = kid(fa, 'OkresFa');
      if (okres) hrows.push(['Okres', `${date(txt(okres, 'P_6_Od'))} – ${date(txt(okres, 'P_6_Do'))}`]);
      const ksef = /(\d{10}-\d{8}-[0-9A-F]{12}-[0-9A-F]{2})/i.exec(FILE.name);
      if (ksef) hrows.push(['Numer KSeF', ksef[1].toUpperCase()]);
      if (cur !== 'PLN') hrows.push(['Waluta', cur + (txt(fa, 'KursWalutyZ') ? ` (kurs ${txt(fa, 'KursWalutyZ')})` : '')]);
      const hk = kv(hrows);
      if (hk) head.append(hk);
      inv.append(head);

      const corr = correction(fa);
      if (corr) inv.append(corr);

      const parties = h('div', { class: 'parties' });
      parties.append(party(kid(r, 'Podmiot1'), 'Sprzedawca'), party(kid(r, 'Podmiot2'), 'Nabywca'));
      for (const p3 of kids(r, 'Podmiot3')) {
        const role = ROLA[txt(p3, 'Rola')] || txt(p3, 'OpisRoli') || 'Inny podmiot';
        parties.append(party(p3, role));
      }
      const pu = kid(r, 'PodmiotUpowazniony');
      if (pu) parties.append(party(pu, 'Podmiot upoważniony'));
      inv.append(parties);

      const pos = positions(fa);
      if (pos) inv.append(pos);
      const vs = vatSummary(fa);
      if (vs) inv.append(vs);

      inv.append(h('section', { class: 'total' },
        h('span', { text: txt(fa, 'RodzajFaktury').startsWith('KOR') ? 'Kwota korekty' : 'Do zapłaty' }),
        h('span', { class: 'amt', text: money(txt(fa, 'P_15')) || '—' })));

      for (const part of [payment(fa), settlement(fa), annotations(fa), conditions(fa), attachment(doc), footer(doc)]) {
        if (part) inv.append(part);
      }
      const gen = [txt(r, 'Naglowek', 'SystemInfo'), date(txt(r, 'Naglowek', 'DataWytworzeniaFa'))].filter(Boolean);
      inv.append(h('div', { class: 'gen', text: `${this.version(doc)}${gen.length ? ' · wystawiono w: ' + gen.join(', ') : ''}` }));
      box.append(inv);
      document.getElementById('main').style.background = 'var(--bg)';
    },
  };
})();
