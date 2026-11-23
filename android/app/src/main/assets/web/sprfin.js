/*
 * Widok e-sprawozdania finansowego (struktura MF dla jednostek innych – załącznik nr 1
 * do ustawy o rachunkowości): wprowadzenie, bilans, rachunek zysków i strat, zestawienie
 * zmian w kapitale, rachunek przepływów, informacja dodatkowa z plikami i podpisy.
 */
'use strict';

const SprFin = (() => {
  const { kid, kids, txt, amount, date, humanize, kvList } = XmlDoc;
  const AMT = ['KwotaA', 'KwotaB', 'KwotaB1'];
  let hideZero = UI.store.get('sf.hideZero', false);
  let showB1 = false;
  let unit = 'zł';

  const num = (v) => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return v === '' || v == null || !Number.isFinite(n) ? null : n; };
  function amounts(el) {
    if (!el) return null;
    const out = {};
    let any = false;
    for (const c of el.children) if (AMT.includes(c.localName) && !c.children.length) { out[c.localName] = c.textContent.trim(); any = true; }
    return any ? out : null;
  }
  const isZero = (a) => !a || AMT.every((k) => !num(a[k]));

  /* ---------- numeracja pozycji z kodów elementów ---------- */
  const isDigit = (s) => /^\d+$/.test(s);
  const isLetter = (s) => /^[A-Z]$/.test(s);
  const NUM = {
    bilans: (segs, side) => {
      const d = segs.length - 1, last = segs[d];
      if (d < 0) return '';
      if (d <= 1) return last + '.';
      if (d === 2) {
        if (side === 'Pasywa' && segs[0] === 'A') return '–'; // „w tym” przy kapitałach
        return isDigit(last) ? last + '.' : last.toLowerCase() + ')';
      }
      if (d === 3 && isLetter(last)) return last.toLowerCase() + ')';
      return '–';
    },
    rzis: (segs) => {
      const d = segs.length - 1, last = segs[d];
      if (d < 0) return '';
      if (d === 0) return last + '.';
      if (last === 'J') return '–';
      if (d === 1) return last + '.';
      if (d === 2 && isLetter(last)) return last.toLowerCase() + ')';
      return '–';
    },
    rpp: (segs) => {
      const d = segs.length - 1, last = segs[d];
      if (d < 0) return '';
      if (d === 0) return last + '.';
      if (d === 1) return isDigit(last) ? '–' : last + '.';
      if (d === 2) return isDigit(last) ? last + '.' : last.toLowerCase() + ')';
      if (d === 3 && isLetter(last)) return last.toLowerCase() + ')';
      return '–';
    },
    zz: (segs) => {
      const d = segs.length - 1, s0 = segs[0], last = segs[d];
      if (d < 0) return '';
      if (d === 0) return s0 === 'IA' ? 'I.a.' : s0 + '.';
      if (s0 !== 'IA') return '–';
      if (d === 1) return last + '.';
      if (d === 2) return isDigit(last) ? `${segs[1]}.${last}.` : last.toLowerCase() + ')';
      if (d === 3 && isLetter(last)) return last.toLowerCase() + ')';
      return '–';
    },
  };

  function collect(el, kind, prefix, labelPrefix, side, rows, depth) {
    for (const c of el.children) {
      const n = c.localName;
      if (AMT.includes(n)) continue;
      if (n === 'PozycjaUszczegolawiajaca') {
        rows.push({ no: '', label: txt(kid(c, 'NazwaPozycji')) || 'pozycja uszczegóławiająca', a: amounts(kid(c, 'KwotyPozycji') || c), depth, extra: true });
        continue;
      }
      let code = n;
      if (prefix && n.startsWith(prefix + '_')) code = n.slice(prefix.length + 1);
      const segs = code.split('_');
      const label = SF_LABELS[labelPrefix + code] || SF_LABELS[n] || humanize(n);
      rows.push({ no: NUM[kind](segs, side), label, a: amounts(c), depth: segs.length - 1 });
      collect(c, kind, prefix, labelPrefix, side, rows, segs.length);
    }
    return rows;
  }

  /* ---------- tabela pozycji ---------- */
  function cols() { return showB1 ? ['KwotaA', 'KwotaB', 'KwotaB1'] : ['KwotaA', 'KwotaB']; }
  const COL_TITLE = { KwotaA: 'Rok bieżący', KwotaB: 'Rok poprzedni', KwotaB1: 'Rok poprz. (przekształcony)' };

  function table(rows, total) {
    const t = h('div', { class: 'sf-tbl' + (showB1 ? ' b1' : '') });
    t.append(h('div', { class: 'sf-r sf-hd' }, h('div', { class: 'sf-l', text: 'Pozycja' }),
      h('div', { class: 'sf-vals' }, ...cols().map((k) => h('span', { text: COL_TITLE[k] })))));
    for (const r of rows) {
      const zero = r.a && isZero(r.a);
      if (zero && hideZero) continue;
      const cls = ['sf-r', 'd' + Math.min(r.depth, 5)];
      if (r.depth === 0 && !r.extra && !r.plain) cls.push('top');
      if (r.extra) cls.push('extra');
      if (zero) cls.push('zero');
      const lbl = h('div', { class: 'sf-l', style: `padding-left:${Math.min(r.depth, 6) * 0.85}em` },
        r.no || r.extra ? h('span', { class: 'no', text: r.no }) : null, h('span', { class: 'tx', text: r.label }));
      const vals = r.a ? h('div', { class: 'sf-vals' }, ...cols().map((k) => h('span', { class: num(r.a[k]) < 0 ? 'neg' : null, text: r.a[k] != null ? amount(r.a[k]) : '' }))) : null;
      t.append(h('div', { class: cls.join(' ') }, lbl, vals));
    }
    if (total) {
      t.append(h('div', { class: 'sf-r total' }, h('div', { class: 'sf-l' }, h('span', { class: 'tx', text: total.label })),
        h('div', { class: 'sf-vals' }, ...cols().map((k) => h('span', { text: total.a && total.a[k] != null ? amount(total.a[k]) : '' })))));
    }
    return t;
  }

  const card = (title, id, sub) => h('section', { class: 'card sf-sec', id }, h('h3', { text: title }), sub ? h('div', { class: 'sf-sub', text: sub }) : null);

  /* ---------- części sprawozdania ---------- */
  function address(a) {
    if (!a) return '';
    const g = (n) => txt(kid(a, n));
    const nr = [g('NrDomu'), g('NrLokalu')].filter(Boolean).join('/');
    const street = g('Ulica');
    const line1 = [street || g('Miejscowosc'), nr].filter(Boolean).join(' ');
    let line2 = [g('KodPocztowy'), street ? g('Miejscowosc') : (g('Poczta') || g('Miejscowosc'))].filter(Boolean).join(' ');
    if (street && g('Poczta') && foldText(g('Poczta')) !== foldText(g('Miejscowosc'))) line2 += ` (poczta ${g('Poczta')})`;
    const lines = [line1, line2].filter(Boolean);
    if (g('KodKraju') && g('KodKraju') !== 'PL') lines.push(g('KodKraju'));
    return lines.join('\n') || a.textContent.replace(/\s+/g, ' ').trim();
  }
  function seat(s) {
    if (!s) return '';
    const g = (n) => txt(kid(s, n));
    return [g('Miejscowosc'), g('Gmina') && `gmina ${g('Gmina')}`, g('Powiat') && `powiat ${g('Powiat')}`, g('Wojewodztwo') && `woj. ${g('Wojewodztwo')}`].filter(Boolean).join(', ');
  }
  const wLabel = (el) => SF_LABELS['W:' + el.localName] || null;

  /** Pojedyncze pole wprowadzenia: dłuższy tekst jako akapit, krótka wartość po prawej. */
  function leafLine(c, p) {
    const v = txt(p);
    const lbl = wLabel(p) || humanize(p.localName);
    if (v.length > 60 || v.includes('\n')) c.append(h('div', { class: 'xd-para' }, h('div', { class: 'lbl', text: lbl }), h('p', { text: v })));
    else c.append(h('div', { class: 'sf-yn' }, h('span', { text: lbl }), h('b', { text: XmlDoc.fmtValue(p.localName, v) || '—' })));
  }

  function intro(w) {
    const c = card('Wprowadzenie do sprawozdania', 'sf-wpr');
    for (const p of w.children) {
      const n = p.localName;
      if (n === 'P_1') {
        c.append(h('h4', { text: SF_LABELS['W:P_1'] }));
        const a = kid(p, 'P_1A');
        const rows = [
          ['Firma', txt(kid(a, 'NazwaFirmy'))],
          ['Siedziba', seat(kid(a, 'Siedziba'))],
          ['Adres', address(kid(kid(p, 'P_1B'), 'Adres') || kid(kid(p, 'P_1B'), 'AdresZagr') || kid(p, 'P_1B'))],
          ['PKD', kids(kid(p, 'P_1C'), 'KodPKD').map(txt).join(', ')],
          ['NIP', txt(kid(p, 'P_1D'))],
          ['KRS', txt(kid(p, 'P_1E'))],
        ];
        c.append(kvList(rows));
        const rest = Array.from(p.children).filter((x) => !['P_1A', 'P_1B', 'P_1C', 'P_1D', 'P_1E'].includes(x.localName));
        for (const x of rest) { c.append(h('h4', { text: wLabel(x) || humanize(x.localName) })); XmlDoc.renderInto(x, c, { labels: wLabel }); }
      } else if (n === 'P_3') {
        c.append(h('h4', { text: SF_LABELS['W:P_3'] }));
        c.append(kvList([['Okres', `${date(txt(kid(p, 'DataOd')))} – ${date(txt(kid(p, 'DataDo')))}`]]));
      } else if (!p.children.length) {
        leafLine(c, p);
      } else if (Array.from(p.children).every((x) => !x.children.length)) {
        c.append(h('h4', { text: wLabel(p) || humanize(n) }));
        for (const x of p.children) leafLine(c, x);
      } else {
        c.append(h('h4', { text: wLabel(p) || humanize(n) }));
        XmlDoc.renderInto(p, c, { labels: wLabel });
      }
    }
    return c;
  }

  function statement(title, id, el, kind, labelPrefix, prefix) {
    if (!el) return null;
    const c = card(title, id, `Kwoty w ${unit}`);
    c.append(table(collect(el, kind, prefix, labelPrefix, '', [], 0)));
    return c;
  }

  function balance(b) {
    if (!b) return null;
    const c = card('Bilans', 'sf-bil', `Stan na koniec roku obrotowego · kwoty w ${unit}`);
    for (const side of ['Aktywa', 'Pasywa']) {
      const el = kid(b, side);
      if (!el) continue;
      c.append(h('h4', { text: side }));
      c.append(table(collect(el, 'bilans', side, '', side, [], 0), { label: SF_LABELS[side], a: amounts(el) }));
    }
    return c;
  }

  function pidAmounts(el) {
    const src = kid(el, 'Kwota') || el;
    const val = (x) => { if (!x) return null; const k = kid(x, 'KwotaC'); return k ? txt(k) : (x.children.length ? null : txt(x)); };
    const a = { KwotaA: val(kid(src, 'RB')), KwotaB: val(kid(src, 'RP')) };
    return a.KwotaA == null && a.KwotaB == null ? null : a;
  }

  function taxInfo(el) {
    const rows = [];
    for (const p of el.children) {
      const m = /^P_ID_(\d+)$/.exec(p.localName);
      rows.push({ no: m ? m[1] + '.' : '', label: SF_LABELS['PID:' + p.localName] || humanize(p.localName), a: pidAmounts(p), depth: 0, plain: true });
      for (const x of p.children) {
        if (['RB', 'RP', 'Kwota'].includes(x.localName)) continue;
        const nm = Array.from(x.children).find((y) => /^(Nazwa|NazwaPozycji|Opis)/.test(y.localName));
        rows.push({ no: '', label: nm ? txt(nm) : humanize(x.localName), a: pidAmounts(x), depth: 1, extra: true });
      }
    }
    const saved = showB1;
    showB1 = false;
    const t = table(rows);
    showB1 = saved;
    return t;
  }

  function notes(di) {
    if (!di) return null;
    const c = card('Informacja dodatkowa', 'sf-inf');
    for (const x of di.children) {
      const n = x.localName;
      if (n === 'DodatkoweInformacjeIObjasnienia') {
        const opis = txt(kid(x, 'Opis'));
        const plik = kid(x, 'Plik');
        if (plik && XmlDoc.isBase64(txt(kid(plik, 'Zawartosc')))) c.append(XmlDoc.fileBox(txt(kid(plik, 'Nazwa')), txt(kid(plik, 'Zawartosc')), opis || null));
        else if (opis) c.append(h('div', { class: 'xd-para' }, h('div', { class: 'lbl', text: 'Opis' }), h('p', { text: opis })));
      } else if (n === 'InformacjaDodatkowaDotyczacaPodatkuDochodowego') {
        c.append(h('h4', { text: 'Informacja dotycząca podatku dochodowego' }));
        c.append(h('div', { class: 'sf-sub', text: `Kwoty w ${unit}` }));
        c.append(taxInfo(x));
      } else {
        c.append(h('h4', { text: humanize(n) }));
        XmlDoc.renderInto(x, c);
      }
    }
    return c;
  }

  function tiles(root) {
    const b = kid(root, 'Bilans');
    const rz = kid(root, 'RZiS');
    const por = kid(rz, 'RZiSPor'), kalk = kid(rz, 'RZiSKalk');
    const items = [
      ['Suma bilansowa', amounts(kid(b, 'Aktywa'))],
      ['Przychody netto ze sprzedaży', amounts(kid(por || kalk, 'A'))],
      ['Zysk (strata) netto', amounts(por ? kid(por, 'L') : kid(kalk, 'O')), true],
      ['Kapitał własny', amounts(kid(kid(b, 'Pasywa'), 'Pasywa_A'))],
    ].filter((x) => x[1]);
    if (!items.length) return null;
    const c = h('section', { class: 'sf-tiles' });
    for (const [label, a, signed] of items) {
      const cur = num(a.KwotaA), prev = num(a.KwotaB);
      let chg = null;
      if (cur != null && prev) {
        const pct = (cur - prev) / Math.abs(prev) * 100;
        chg = h('span', { class: 'chg ' + (pct >= 0 ? 'up' : 'down'), text: `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%` });
      }
      c.append(h('div', { class: 'tile' },
        h('div', { class: 'lbl', text: label }),
        h('div', { class: 'val' + (signed && cur != null ? (cur < 0 ? ' neg' : ' pos') : ''), text: cur == null ? '—' : `${amount(a.KwotaA, 0)} ${unit}` }),
        h('div', { class: 'prev' }, prev == null ? '' : `rok wcześniej: ${amount(a.KwotaB, 0)}`, chg ? ' ' : '', chg)));
    }
    return c;
  }

  function headInfo(doc) {
    const r = doc.documentElement;
    const n = kid(r, 'Naglowek');
    const w = kid(r, 'WprowadzenieDoSprawozdaniaFinansowego');
    const p1 = kid(w, 'P_1');
    const ks = kid(n, 'KodSprawozdania');
    return {
      name: txt(kid(kid(p1, 'P_1A'), 'NazwaFirmy')),
      from: txt(kid(n, 'OkresOd')), to: txt(kid(n, 'OkresDo')),
      made: txt(kid(n, 'DataSporzadzenia')),
      nip: txt(kid(p1, 'P_1D')), krs: txt(kid(p1, 'P_1E')),
      city: txt(kid(kid(kid(p1, 'P_1A'), 'Siedziba'), 'Miejscowosc')),
      thousands: /WTysiacach/i.test(txt(ks) + ' ' + r.namespaceURI),
      schema: ks ? ks.getAttribute('wersjaSchemy') || '' : '',
      code: ks ? ks.getAttribute('kodSystemowy') || '' : '',
      variant: txt(kid(n, 'WariantSprawozdania')),
    };
  }

  return {
    detect(doc) {
      const r = doc && doc.documentElement;
      return !!r && /^JednostkaInna/.test(r.localName) && /mf\.gov\.pl\/schematy\/SF/i.test(r.namespaceURI || '') && !!kid(r, 'Bilans');
    },

    info(doc) {
      const i = headInfo(doc);
      return [
        ['Jednostka', i.name],
        ['Okres', `${date(i.from)} – ${date(i.to)}`],
        ['NIP', i.nip],
        ['Struktura', ['e-sprawozdanie finansowe, jednostka inna', i.code, i.schema && 'wersja ' + i.schema].filter(Boolean).join(', ')],
        ['Wariant sprawozdania', i.variant],
      ].filter((x) => x[1]);
    },

    get hideZero() { return hideZero; },
    set hideZero(v) { hideZero = v; UI.store.set('sf.hideZero', v); },

    render(doc, box) {
      const r = doc.documentElement;
      const i = headInfo(doc);
      unit = i.thousands ? 'tys. zł' : 'zł';
      showB1 = Array.from(r.getElementsByTagName('*')).some((e) => e.localName === 'KwotaB1' && num(e.textContent.trim()));
      box.innerHTML = '';
      const wrap = h('div', { class: 'inv xd sf' });

      const head = h('section', { class: 'inv-head' },
        h('div', { class: 'kind', text: 'Sprawozdanie finansowe' }),
        h('h1', { text: i.name || 'Jednostka' }));
      head.append(kvList([
        ['Rok obrotowy', `${date(i.from)} – ${date(i.to)}`],
        ['Sporządzono', date(i.made)],
        ['NIP', i.nip], ['KRS', i.krs], ['Siedziba', i.city],
        ['Rodzaj', `jednostka inna (zał. nr 1 do ustawy o rachunkowości), kwoty w ${unit}`],
      ]));
      wrap.append(head);

      const t = tiles(r);
      if (t) wrap.append(t);

      const parts = [];
      const w = kid(r, 'WprowadzenieDoSprawozdaniaFinansowego');
      if (w) parts.push(['Wprowadzenie', intro(w)]);
      parts.push(['Bilans', balance(kid(r, 'Bilans'))]);
      const rz = kid(r, 'RZiS');
      const por = kid(rz, 'RZiSPor'), kalk = kid(rz, 'RZiSKalk');
      if (por) parts.push(['Rachunek zysków i strat', statement('Rachunek zysków i strat (wariant porównawczy)', 'sf-rzis', por, 'rzis', 'RZiSPor:', '')]);
      if (kalk) parts.push(['Rachunek zysków i strat', statement('Rachunek zysków i strat (wariant kalkulacyjny)', 'sf-rzis', kalk, 'rzis', 'RZiSKalk:', '')]);
      parts.push(['Zmiany w kapitale', statement('Zestawienie zmian w kapitale (funduszu) własnym', 'sf-zz', kid(r, 'ZestZmianWKapitale'), 'zz', 'ZZ:', '')]);
      const rpp = kid(r, 'RachPrzeplywow');
      const posr = kid(rpp, 'PrzeplywyPosr'), bezp = kid(rpp, 'PrzeplywyBezp');
      if (posr) parts.push(['Przepływy pieniężne', statement('Rachunek przepływów pieniężnych (metoda pośrednia)', 'sf-rpp', posr, 'rpp', 'PrzeplywyPosr:', '')]);
      if (bezp) parts.push(['Przepływy pieniężne', statement('Rachunek przepływów pieniężnych (metoda bezpośrednia)', 'sf-rpp', bezp, 'rpp', 'PrzeplywyBezp:', '')]);
      const di = Array.from(r.children).find((c) => /^DodatkoweInformacje/.test(c.localName));
      parts.push(['Informacja dodatkowa', notes(di)]);
      // pozostałe, nieznane części – w widoku ogólnym
      const known = ['Naglowek', 'WprowadzenieDoSprawozdaniaFinansowego', 'Bilans', 'RZiS', 'ZestZmianWKapitale', 'RachPrzeplywow', 'Signature'];
      for (const x of r.children) {
        if (known.includes(x.localName) || x === di) continue;
        const c = card(humanize(x.localName), null);
        XmlDoc.renderInto(x, c);
        parts.push([humanize(x.localName), c]);
      }
      const sigs = XmlDoc.signaturesCard(doc);
      if (sigs) parts.push(['Podpisy', sigs]);

      const toc = h('nav', { class: 'sf-toc' });
      for (const [name, el] of parts) {
        if (!el) continue;
        toc.append(h('button', { text: name, onclick: () => el.scrollIntoView({ block: 'start', behavior: 'smooth' }) }));
      }
      wrap.append(toc);
      for (const [, el] of parts) if (el) wrap.append(el);
      wrap.append(h('div', { class: 'gen', text: 'Nazwy pozycji według załącznika nr 1 do ustawy o rachunkowości.' }));
      box.append(wrap);
      document.getElementById('main').style.background = 'var(--bg)';
    },
  };
})();
