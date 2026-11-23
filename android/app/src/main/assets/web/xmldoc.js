/*
 * Dowolny XML pokazany jako czytelny dokument: nazwy pól zamienione na zwykłe słowa,
 * pojedyncze wartości jako pary „pole: wartość”, powtarzające się rekordy jako tabele,
 * zagnieżdżone grupy jako zwijane sekcje, pliki zapisane w base64 do otwarcia
 * i podsumowanie podpisów elektronicznych (XAdES).
 */
'use strict';

const XmlDoc = (() => {
  const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
  const isSig = (el) => el.localName === 'Signature' && el.namespaceURI === DSIG;
  const kid = (el, name) => (el ? Array.from(el.children).find((c) => c.localName === name) || null : null);
  const kids = (el, name) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
  const desc = (el, name) => (el ? Array.from(el.getElementsByTagName('*')).find((c) => c.localName === name) || null : null);
  const descAll = (el, name) => (el ? Array.from(el.getElementsByTagName('*')).filter((c) => c.localName === name) : []);
  const txt = (el) => (el ? el.textContent.trim() : '');
  const ownText = (el) => {
    let s = '';
    for (const n of el.childNodes) if (n.nodeType === 3 || n.nodeType === 4) s += n.data;
    return s.trim();
  };
  const isLeaf = (el) => el.children.length === 0;

  /* ---------- nazwy pól po ludzku ---------- */
  const PL = {};
  for (const w of ('wartość ilość miejscowość województwo województwa sporządzenia płatność płatności należność należności ' +
    'zobowiązania zobowiązanie imię panieńskie płeć treść tytuł tytułu środki środków źródło początek rozpoczęcia ' +
    'zakończenia sprzedaży sprzedaż zapłaty zapłata wpłaty wpłata właściciel działalność działalności załącznik ' +
    'załącznika załączniki uszczegóławiająca objaśnienia dotycząca język skrócona pełna wysokość szerokość długość ' +
    'głębokość własność własny własne własna sąd sądu wpływ wpływy przepływy przepływów oświadczenie oświadczenia ' +
    'świadczenia świadczenie mała miesiąc miesiąca dzień ważny ważności ważność podpisujący główny główna zamówienie ' +
    'zamówienia zamawiający składka składki społeczne płatnik płatnika księgowy księgi powód usługi usługa usług ' +
    'ścieżka zawartość skrót hasło użytkownik złożenia złożenie urząd urzędu wspólnik wspólnicy członek członków ' +
    'zarząd zarządu średni średnie średnioroczne łączna łączny łącznie ogółem wartości różnica różnice nadpłata ' +
    'zaległość opłata opłaty wypłata wypłaty przychód dochód należny należna należne wyłącznie numer kwota ' +
    'świadectwo przyjęcia odbiorów doręczenia nadania potwierdzenie część części stanowisko liczba oznaczenie ' +
    'kontrahent miejsce rejestru wpisu identyfikator identyfikacyjne identyfikacyjny dziedzina opłat dostawa dostawy ' +
    'wyroby wyrobów ilości jednostek jednostkę przekształcone poprzedni bieżący bieżąca bieżące nagłówek zgłoszenie ' +
    'zgłoszenia przedsiębiorca przedsiębiorcy spółka spółki właściwy właściwego miesięczny kwartał kwartału pełnomocnik ' +
    'pełnomocnika osób dotyczące wyłączenie dowód sieć kanał żądanie odpowiedź błąd błędy błędów ustawień ' +
    'zwiększenie zmniejszenie zwiększenia zmniejszenia razem uwagi godzina sekcja wiadomość wiadomości').split(' ')) {
    PL[foldText(w)] = w;
  }

  function humanize(name) {
    if (!name) return '';
    if (/^[A-Z]{1,4}(_[\dA-Z]+)+$/.test(name)) return name; // kody pól: P_1A, K_10, P_ID_1
    const s = name
      .replace(/[_\-.]+/g, ' ')
      .replace(/([a-ząćęłńóśźż])([A-ZĄĆĘŁŃÓŚŹŻ])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-zA-Z])(\d)/g, '$1 $2');
    const words = s.split(/\s+/).filter(Boolean).map((w, i) => {
      if (/^[A-Z0-9]{2,}$/.test(w)) return w; // skróty: NIP, KRS, PKD, VAT
      let lw = w.toLowerCase();
      lw = PL[lw] || lw;
      return i === 0 ? lw.charAt(0).toUpperCase() + lw.slice(1) : lw;
    });
    return words.join(' ');
  }

  /* ---------- formaty wartości ---------- */
  const NB = ' ';
  function groupInt(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, NB); }
  /** Kwota z separatorem tysięcy (zawsze, także dla 4 cyfr) i przecinkiem: 1 303,25 */
  function amount(v, dec = 2) {
    const n = Number(String(v).replace(',', '.'));
    if (v === '' || v == null || !Number.isFinite(n)) return v == null ? '' : String(v);
    const fixed = Math.abs(n).toFixed(dec);
    const [i, f] = fixed.split('.');
    return (n < 0 && Number(fixed) !== 0 ? '-' : '') + groupInt(i) + (f ? ',' + f : '');
  }
  function date(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(.*)$/.exec(v || '');
    if (!m) return v || '';
    let s = `${m[3]}.${m[2]}.${m[1]}`;
    if (m[4]) {
      const d = m[7] ? new Date(v) : null;
      if (d && !isNaN(d)) s = d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      else s += ` ${m[4]}:${m[5]}`;
    }
    return s;
  }
  const AMOUNT_NAME = /kwot|wartos|suma|cena|amount|price|total|saldo|netto|brutto|podatek|vat|naleznos|zobowiaz|przych|koszt|dochod/i;
  function isAmountName(name) { return AMOUNT_NAME.test(foldText(name || '')); }

  function fmtValue(name, v) {
    if (v === 'true') return 'tak';
    if (v === 'false') return 'nie';
    if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return date(v);
    if (/wersj|version/i.test(name || '')) return v;
    if (/^-?\d+\.\d{2}$/.test(v)) return amount(v);
    if (/^-?\d+(\.\d+)?$/.test(v) && isAmountName(name) && !/^0\d/.test(v)) return amount(v, Math.max(2, (v.split('.')[1] || '').length));
    if (/^-?\d+\.\d+$/.test(v)) return v.replace('.', ',');
    return v;
  }
  const isNumeric = (v) => /^-?\d[\d  ]*(,\d+)?$/.test(v);

  /* ---------- pliki zapisane w base64 ---------- */
  function isBase64(v) {
    if (v.length < 400 || !/^[A-Za-z0-9+/=\s]+$/.test(v.slice(0, 4000))) return false;
    const head = v.slice(0, 4000);
    const ws = (head.match(/\s/g) || []).length;
    return ws / head.length < 0.05 && /\S{60,}/.test(head);
  }
  const MAGIC = [
    ['JVBER', 'pdf', 'Dokument PDF'], ['iVBORw0KGgo', 'png', 'Obraz PNG'], ['/9j/', 'jpg', 'Obraz JPG'], ['R0lGOD', 'gif', 'Obraz GIF'],
    ['UEsDB', 'zip', 'Archiwum / dokument Office'], ['0M8R4KGx', 'doc', 'Dokument Office (stary format)'], ['PD94bWwg', 'xml', 'Plik XML'],
    ['77u/PD94', 'xml', 'Plik XML'], ['e1xydGY', 'rtf', 'Dokument RTF'], ['SUkq', 'tif', 'Obraz TIFF'], ['TU0AKg', 'tif', 'Obraz TIFF'],
  ];
  function guessFile(b64) {
    const head = b64.slice(0, 16).replace(/\s/g, '');
    const m = MAGIC.find(([p]) => head.startsWith(p));
    return m ? { ext: m[1], kind: m[2] } : { ext: 'bin', kind: 'Plik' };
  }
  const b64Size = (b64) => { const c = b64.replace(/\s/g, ''); return Math.floor(c.length * 3 / 4) - (c.endsWith('==') ? 2 : c.endsWith('=') ? 1 : 0); };

  function fileBox(name, b64, label) {
    const g = guessFile(b64);
    if (!name || !/\.\w{2,5}$/.test(name)) name = (name || 'plik') + '.' + g.ext;
    const box = h('div', { class: 'xd-file' },
      h('span', { class: 'ic', html: icon('attach') }),
      h('div', { class: 'meta' },
        h('div', { class: 'nm', text: label || name }),
        h('div', { class: 'sz', text: [label ? name : g.kind, UI.formatSize(b64Size(b64))].join(' · ') })),
      h('button', { class: 'open', text: 'Otwórz', onclick: () => UI.openBase64(name, b64, 'Plik zapisany w ' + FILE.name) }));
    return box;
  }
  function fileNameNear(el) {
    const p = el.parentElement;
    for (const a of ['nazwa', 'nazwapliku', 'name', 'filename', 'nazwazalacznika', 'plik']) {
      if (el.getAttribute && el.getAttribute(a)) return el.getAttribute(a);
      const sib = p && Array.from(p.children).find((c) => c !== el && isLeaf(c) && foldText(c.localName) === a && txt(c).length < 260);
      if (sib) return txt(sib);
    }
    for (const at of el.attributes || []) if (/name|nazwa/i.test(at.localName)) return at.value;
    return '';
  }

  /* ---------- certyfikat X.509 (tylko odczyt nazw i dat) ---------- */
  const OID = {
    '2.5.4.3': 'CN', '2.5.4.4': 'SN', '2.5.4.42': 'GN', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.6': 'C',
    '2.5.4.7': 'L', '2.5.4.12': 'T', '2.5.4.97': 'OID', '2.5.4.5': 'SERIAL',
  };
  function parseCert(b64) {
    try {
      const bin = atob(b64.replace(/\s+/g, ''));
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const read = (pos) => {
        const tag = u8[pos++];
        let len = u8[pos++];
        if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + u8[pos++]; }
        return { tag, start: pos, end: pos + len };
      };
      const children = (node) => { const out = []; for (let p = node.start; p < node.end;) { const c = read(p); out.push(c); p = c.end; } return out; };
      const oid = (node) => {
        const b = u8.subarray(node.start, node.end);
        const parts = [Math.floor(b[0] / 40), b[0] % 40];
        let v = 0;
        for (let i = 1; i < b.length; i++) { v = v * 128 + (b[i] & 0x7f); if (!(b[i] & 0x80)) { parts.push(v); v = 0; } }
        return parts.join('.');
      };
      const str = (node) => {
        const b = u8.subarray(node.start, node.end);
        if (node.tag === 0x1e) { let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b[i] << 8 | b[i + 1]); return s; }
        return new TextDecoder(node.tag === 0x0c ? 'utf-8' : 'latin1').decode(b);
      };
      const name = (node) => {
        const out = {};
        for (const set of children(node)) for (const atv of children(set)) {
          const [o, v] = children(atv);
          const key = OID[oid(o)];
          if (key && !out[key]) out[key] = str(v);
        }
        return out;
      };
      const time = (node) => {
        const s = str(node);
        const m = node.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s) : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s);
        if (!m) return null;
        const y = node.tag === 0x17 ? (Number(m[1]) < 50 ? 2000 : 1900) + Number(m[1]) : Number(m[1]);
        return new Date(Date.UTC(y, m[2] - 1, m[3], m[4], m[5]));
      };
      const [tbs] = children(read(0));
      let f = children(tbs);
      if (f[0].tag === 0xa0) f = f.slice(1);
      const validity = children(f[3]);
      return { issuer: name(f[2]), subject: name(f[4]), from: time(validity[0]), to: time(validity[1]) };
    } catch (e) {
      return null;
    }
  }
  const dmy = (d) => (d ? d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
  const parseDn = (s) => {
    const out = {};
    for (const part of (s || '').split(/,(?=\s*[A-Za-z.\d]+=)/)) {
      const m = /^\s*([^=]+)=(.*)$/.exec(part);
      if (m) out[m[1].trim().toUpperCase()] = m[2].trim();
    }
    return { CN: out.CN, O: out.O, SN: out.SN, GN: out.GIVENNAME || out.G || out.GN };
  };

  const COMMIT = {
    ProofOfOrigin: 'potwierdzenie pochodzenia', ProofOfReceipt: 'potwierdzenie odbioru', ProofOfDelivery: 'potwierdzenie doręczenia',
    ProofOfSender: 'potwierdzenie nadania', ProofOfApproval: 'formalne zatwierdzenie', ProofOfCreation: 'utworzenie',
  };

  function signatureInfo(sig) {
    const certEl = desc(kid(sig, 'KeyInfo'), 'X509Certificate') || desc(sig, 'EncapsulatedX509Certificate');
    const cert = certEl ? parseCert(txt(certEl)) : null;
    const info = { kind: 'Podpis elektroniczny' };
    if (cert) {
      const s = cert.subject;
      info.name = s.CN || [s.GN, s.SN].filter(Boolean).join(' ') || s.O || '';
      if (s.O && s.O !== info.name) info.org = s.O;
      if (s.T) info.title = s.T;
      info.issuer = [cert.issuer.CN, cert.issuer.O].filter(Boolean).join(', ');
      if (cert.from && cert.to) info.valid = `${dmy(cert.from)} – ${dmy(cert.to)}`;
    } else {
      const sn = desc(sig, 'X509SubjectName');
      if (sn) { const d = parseDn(txt(sn)); info.name = d.CN || [d.GN, d.SN].filter(Boolean).join(' '); info.org = d.O; }
      const iss = desc(sig, 'X509IssuerName');
      if (iss) { const d = parseDn(txt(iss)); info.issuer = [d.CN, d.O].filter(Boolean).join(', '); }
    }
    // podpis zaufany (ePUAP) – dane osoby w ds:Object
    const pz = desc(sig, 'PodpisZP') || desc(sig, 'DaneZPOsobyFizycznej');
    if (pz) {
      info.kind = 'Podpis zaufany';
      const im = txt(desc(pz, 'Imie')) || txt(desc(pz, 'ImiePierwsze'));
      const nz = txt(desc(pz, 'Nazwisko'));
      if (im || nz) info.name = [im, nz].filter(Boolean).join(' ');
      info.org = '';
    }
    const st = desc(sig, 'SigningTime');
    if (st) info.time = date(txt(st));
    const role = descAll(sig, 'ClaimedRole').map(txt).filter(Boolean);
    if (role.length) info.role = role.join(', ');
    const commit = descAll(sig, 'CommitmentTypeId').map((c) => {
      const id = txt(desc(c, 'Identifier') || c);
      const k = Object.keys(COMMIT).find((x) => id.includes(x));
      return k ? COMMIT[k] : '';
    }).filter(Boolean);
    if (commit.length) info.commit = commit.join(', ');
    if (desc(sig, 'SignatureTimeStamp')) info.ts = true;
    const ext = kids(kid(sig, 'SignedInfo'), 'Reference').map((r) => r.getAttribute('URI') || '')
      .filter((u) => u && !u.startsWith('#')).map((u) => decodeURIComponent(u.replace(/^.*\//, '')));
    if (ext.length) info.files = ext;
    return info;
  }

  function signaturesCard(doc) {
    const sigs = descAll(doc.documentElement, 'Signature').filter(isSig);
    if (isSig(doc.documentElement)) sigs.unshift(doc.documentElement);
    if (!sigs.length) return null;
    const c = h('section', { class: 'card xd-sigs', id: 'xd-podpisy' }, h('h3', { text: sigs.length > 1 ? `Podpisy elektroniczne (${sigs.length})` : 'Podpis elektroniczny' }));
    for (const s of sigs) {
      const i = signatureInfo(s);
      const rows = [];
      if (i.time) rows.push(['Data podpisu', i.time]);
      if (i.org) rows.push(['Organizacja', i.org]);
      if (i.title || i.role) rows.push(['Rola', [i.title, i.role].filter(Boolean).join(', ')]);
      if (i.commit) rows.push(['Rodzaj zobowiązania', i.commit]);
      if (i.issuer) rows.push(['Wystawca certyfikatu', i.issuer]);
      if (i.valid) rows.push(['Certyfikat ważny', i.valid]);
      if (i.files) rows.push([i.files.length > 1 ? 'Podpisane pliki' : 'Podpisany plik', i.files.join('\n') + ' (osobny plik)']);
      c.append(h('div', { class: 'xd-sig' },
        h('span', { class: 'ic', html: icon('sign') }),
        h('div', { class: 'body' },
          h('div', { class: 'who', text: i.name || 'Nieznana osoba' }),
          h('div', { class: 'kind', text: i.kind + (i.ts ? ' ze znacznikiem czasu' : '') }),
          kvList(rows))));
    }
    c.append(h('p', { class: 'xd-note', text: 'To tylko odczyt danych z podpisu – aplikacja nie sprawdza jego ważności. Do weryfikacji użyj np. weryfikatora podpisu na gov.pl.' }));
    return c;
  }

  /* ---------- budowanie widoku ---------- */
  function kvList(rows) {
    const dl = h('dl', { class: 'kv' });
    for (const [k, v] of rows) if (v !== '' && v != null) dl.append(h('dt', { text: k }), h('dd', null, v));
    return dl.childNodes.length ? dl : null;
  }
  const SKIP_ATTR = (a) => a.name.startsWith('xmlns') || a.namespaceURI === 'http://www.w3.org/2001/XMLSchema-instance';
  const attrList = (el) => Array.from(el.attributes || []).filter((a) => !SKIP_ATTR(a));
  const attrLine = (el) => attrList(el).map((a) => `${humanize(a.localName).toLowerCase()}: ${fmtValue(a.localName, a.value)}`).join(' · ');

  let opts = { all: false, labels: null };
  let budget = 0;
  let lazyLeft = false;
  const label = (el) => (opts.labels && opts.labels(el)) || humanize(el.localName);

  function leafValue(el) {
    const v = ownText(el);
    const a = attrLine(el);
    const val = v ? fmtValue(el.localName, v) : (a ? '' : '—');
    if (!a) return val;
    if (!v) return attrList(el).map((x) => `${humanize(x.localName).toLowerCase()}: ${fmtValue(x.localName, x.value)}`).join('\n');
    return h('span', null, val, h('span', { class: 'xd-attr', text: (val ? ' ' : '') + a }));
  }

  /** Grupa rekordów o tej samej nazwie: tabela (mało kolumn) albo karty. */
  function records(run, depth) {
    const cols = [];
    const seen = new Set();
    for (const r of run) {
      for (const a of attrList(r)) if (!seen.has('@' + a.name)) { seen.add('@' + a.name); cols.push({ attr: a.name, title: humanize(a.localName) }); }
      for (const c of r.children) if (!seen.has(c.localName)) { seen.add(c.localName); cols.push({ name: c.localName, title: label(c) }); }
      if (!r.children.length && ownText(r) && !seen.has('#text')) { seen.add('#text'); cols.push({ text: true, title: 'Wartość' }); }
    }
    const val = (r, col) => {
      if (col.attr) return fmtValue(col.attr, r.getAttribute(col.attr) || '');
      if (col.text) return fmtValue(r.localName, ownText(r));
      const cs = kids(r, col.name);
      return cs.map((c) => fmtValue(c.localName, ownText(c))).join('\n');
    };
    const wrap = h('div', { class: 'xd-recs' }, h('h4', { text: `${label(run[0])} (${run.length})` }));
    const long = run.some((r) => Array.from(r.children).some((c) => ownText(c).length > 60) || (!r.children.length && ownText(r).length > 60));
    const PAGE = opts.all ? Infinity : (cols.length <= 4 && !long ? 200 : 60);
    let shown = 0;
    let body;
    if (cols.length <= 4 && !long) {
      const numCol = (c) => run.slice(0, 50).every((r) => { const v = val(r, c); return !v || isNumeric(v); });
      const t = h('table', { class: 'xd-tbl' }, h('thead', null, h('tr', null, h('th', { text: 'Lp.' }), ...cols.map((c) => h('th', { class: numCol(c) ? 'num' : null, text: c.title })))));
      body = h('tbody');
      t.append(body);
      wrap.append(h('div', { class: 'tblwrap' }, t));
    } else {
      body = h('div', { class: 'xd-cards' });
      wrap.append(body);
    }
    const more = h('button', { class: 'xd-more' });
    const add = () => {
      const end = Math.min(run.length, shown + PAGE);
      const frag = document.createDocumentFragment();
      for (let i = shown; i < end; i++) {
        const r = run[i];
        if (body.tagName === 'TBODY') {
          frag.append(h('tr', null, h('td', { class: 'lp', text: String(i + 1) }), ...cols.map((c) => {
            const v = val(r, c);
            return h('td', { class: isNumeric(v) ? 'num' : null, text: v });
          })));
        } else {
          const rows = cols.map((c) => [c.title, val(r, c)]).filter((x) => x[1]);
          frag.append(h('div', { class: 'xd-rec' }, h('div', { class: 'xd-rec-h', text: `${label(r)} ${i + 1}` }), kvList(rows)));
        }
      }
      body.append(frag);
      budget += (end - shown) * cols.length;
      shown = end;
      if (shown < run.length) { more.textContent = `Pokaż kolejne (${(run.length - shown).toLocaleString('pl-PL')})`; lazyLeft = true; } else more.remove();
    };
    more.onclick = add;
    add();
    if (shown < run.length) wrap.append(more);
    return wrap;
  }

  const isFlat = (el) => el.children.length > 0 && el.children.length <= 40 && Array.from(el.children).every((c) => isLeaf(c) && !isBase64(ownText(c)));

  function renderChildren(el, depth, box) {
    const items = Array.from(el.children).filter((c) => !isSig(c));
    let rows = [];
    const flush = () => { const k = kvList(rows); if (k) box.append(k); rows = []; };
    for (let i = 0; i < items.length;) {
      const c = items[i];
      let j = i + 1;
      while (j < items.length && items[j].localName === c.localName) j++;
      const run = items.slice(i, j);
      if (isLeaf(c) && run.length >= 2 && run.some((r) => attrList(r).length) && !run.some((r) => isBase64(ownText(r)))) {
        flush();
        box.append(records(run, depth));
      } else if (isLeaf(c)) {
        for (const r of run) {
          const v = ownText(r);
          if (isBase64(v)) { flush(); box.append(fileBox(fileNameNear(r), v)); continue; }
          if (v.length > 140 || /\n.*\S/.test(v)) { flush(); box.append(h('div', { class: 'xd-para' }, h('div', { class: 'lbl', text: label(r) }), h('p', { text: v }))); continue; }
          rows.push([label(r), leafValue(r)]);
        }
      } else if (run.length >= 2 && run.every(isFlat)) {
        flush();
        box.append(records(run, depth));
      } else {
        flush();
        run.forEach((r, k) => box.append(section(r, depth + 1, run.length > 1 ? k + 1 : 0)));
      }
      i = j;
    }
    flush();
  }

  function sectionBody(el, depth, body) {
    budget += el.children.length + 1;
    const own = ownText(el);
    if (own && el.children.length) { // treść mieszana (tekst z znacznikami)
      body.append(h('p', { class: 'xd-mixed', text: el.textContent.replace(/\s+/g, ' ').trim() }));
      return;
    }
    const a = attrList(el);
    if (a.length) { const k = kvList(a.map((x) => [humanize(x.localName), fmtValue(x.localName, x.value)])); if (k) { k.classList.add('xd-attrs'); body.append(k); } }
    renderChildren(el, depth, body);
  }

  function section(el, depth, index) {
    const title = label(el) + (index ? ` ${index}` : '');
    const size = el.getElementsByTagName('*').length;
    const open = opts.all || (depth < 3 && budget < 6000) || size < 4;
    const det = h('details', { class: 'xd-sec' }, h('summary', { text: title }));
    const body = h('div', { class: 'xd-body' });
    det.append(body);
    let done = false;
    const fill = () => { if (!done) { done = true; sectionBody(el, depth, body); } };
    if (open) { det.open = true; fill(); } else { lazyLeft = true; det.addEventListener('toggle', fill); }
    return det;
  }

  function card(el, title, id) {
    const c = h('section', { class: 'card', id }, h('h3', { text: title }));
    sectionBody(el, 0, c);
    return c;
  }

  return {
    humanize, amount, date, fmtValue, parseCert, signatureInfo, signaturesCard, fileBox, fileNameNear, isBase64, kvList,
    kid, kids, desc, txt,

    /** Wnętrze elementu jako pola/tabele/sekcje (do użycia także w widokach specjalnych). */
    renderInto(el, box, { labels = null, all = true } = {}) {
      const saved = opts;
      opts = { all, labels };
      sectionBody(el, 1, box);
      opts = saved;
    },

    get hasLazy() { return lazyLeft; },

    render(doc, box, { all = false } = {}) {
      opts = { all, labels: null };
      budget = 0;
      lazyLeft = false;
      box.innerHTML = '';
      let root = doc.documentElement;
      const wrap = h('div', { class: 'inv xd' });

      const head = h('section', { class: 'inv-head' }, h('div', { class: 'kind', text: 'Dokument XML' }));
      let content = root;
      if (isSig(root)) {
        head.firstChild.textContent = 'Dokument podpisany elektronicznie';
        content = null;
      }
      const inner = FILE.name.replace(/\.(xades|xml|sig|xsig)$/i, '');
      const innerName = /\.\w{2,5}$/.test(inner) && inner !== FILE.name ? inner : '';
      head.append(h('h1', { text: content ? humanize(root.localName) : innerName || (signatureInfo(root).files || ['Podpis XAdES'])[0] }));
      const hrows = [];
      const loc = root.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'schemaLocation') ||
        root.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'noNamespaceSchemaLocation');
      if (loc) hrows.push(['Schemat', decodeURIComponent(loc.trim().split(/\s+/).pop().replace(/^.*\//, ''))]);
      else if (root.namespaceURI && content) hrows.push(['Przestrzeń nazw', root.namespaceURI.replace(/^https?:\/\//, '')]);
      const hk = kvList(hrows);
      if (hk) head.append(hk);
      wrap.append(head);

      if (content) {
        const top = Array.from(root.children).filter((c) => !isSig(c));
        const leaves = top.filter((c) => isLeaf(c));
        const a = attrList(root);
        if (leaves.length || a.length || !top.length) {
          const c = h('section', { class: 'card' }, h('h3', { text: 'Dane' }));
          const k = kvList(a.map((x) => [humanize(x.localName), fmtValue(x.localName, x.value)]));
          if (k) c.append(k);
          const tmp = h('div');
          for (const l of leaves) tmp.append(l.cloneNode(true));
          renderChildren(tmp, 0, c);
          if (!top.length && ownText(root)) c.append(h('p', { class: 'xd-mixed', text: ownText(root) }));
          wrap.append(c);
        }
        // pozostałe: grupy rekordów albo osobne karty
        const complex = top.filter((c) => !isLeaf(c));
        for (let i = 0; i < complex.length;) {
          const c = complex[i];
          let j = i + 1;
          while (j < complex.length && complex[j].localName === c.localName) j++;
          const run = complex.slice(i, j);
          if (run.length >= 2 && run.every(isFlat)) {
            const cc = h('section', { class: 'card' });
            cc.append(records(run, 0));
            wrap.append(cc);
          } else {
            run.forEach((r, k) => wrap.append(card(r, label(r) + (run.length > 1 ? ` ${k + 1}` : ''))));
          }
          i = j;
        }
      } else {
        // podpis otaczający: treść dokumentu w ds:Object
        for (const obj of kids(root, 'Object')) {
          if (kid(obj, 'QualifyingProperties')) continue;
          const v = ownText(obj);
          const c = h('section', { class: 'card' }, h('h3', { text: 'Podpisana treść' }));
          if (isBase64(v)) {
            const sig = signatureInfo(root);
            const mime = txt(desc(root, 'MimeType'));
            const m2 = obj.getAttribute('MimeType') || mime;
            const name = innerName || (sig.files && sig.files[0]) || obj.getAttribute('Id') || 'dokument';
            c.append(fileBox(/\.\w{2,5}$/.test(name) ? name : name + (m2.includes('pdf') ? '.pdf' : m2.includes('xml') ? '.xml' : ''), v));
          } else if (obj.children.length) {
            for (const ch of obj.children) {
              c.append(h('h4', { text: humanize(ch.localName) }));
              sectionBody(ch, 1, c);
            }
          } else if (v) c.append(h('p', { class: 'xd-mixed', text: v }));
          wrap.append(c);
        }
      }
      const sc = signaturesCard(doc);
      if (sc) wrap.append(sc);
      box.append(wrap);
      document.getElementById('main').style.background = 'var(--bg)';
    },
  };
})();
