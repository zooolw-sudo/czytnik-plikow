/*
 * Przeglądarka arkuszy (XLSX, XLSM, XLSB, XLS, ODS, CSV) oparta na SheetJS.
 * Siatka z literami kolumn i numerami wierszy, scalone komórki, szerokości kolumn,
 * zakładki arkuszy, podgląd komórki z formułą, szukanie i przejście do komórki.
 */
'use strict';

// Polski zapis dat dla wbudowanych formatów Excela (14 = data krótka, 22 = data i godzina)
XLSX.SSF.load('dd\\.mm\\.yyyy', 14);
XLSX.SSF.load('dd\\.mm\\.yyyy hh:mm', 22);
XLSX.SSF.load('dd\\.mmm\\.yy', 15);

const scroller = document.getElementById('main');
const content = document.getElementById('content');
const tabsEl = document.getElementById('tabs');
const info = document.getElementById('cellinfo');
document.getElementById('ciClose').innerHTML = icon('close');
document.getElementById('ciClose').onclick = () => selectCell(null);

const CHUNK = 250;
const isCsv = FILE.type === 'csv';
let raw = null, wb = null, cur = -1, showFormulas = false;
let csvEnc = null, csvSep = null;
let S = null;          // stan bieżącego arkusza
let finder = null, hits = [], hitIdx = -1;

const zp = new ZoomPane(scroller, content, { min: 0.3, max: 4, fit: () => 1 });

UI.bar({
  actions: [{ icon: 'search', label: 'Szukaj', onClick: openFind }],
  menu: () => {
    const m = [{ icon: 'goto', label: 'Przejdź do komórki…', onClick: gotoCell }];
    if (!isCsv) m.push({ icon: 'info', label: 'Pokaż formuły', checked: showFormulas, onClick: () => { showFormulas = !showFormulas; openSheet(cur); } });
    m.push({ icon: 'fit', label: 'Rozmiar 100%', onClick: () => zp.setZoom(1, 0, 0) });
    if (isCsv) {
      m.push({ icon: 'text', label: 'Kodowanie znaków…', onClick: () => chooseEncoding(csvEnc, (e) => { csvEnc = e; loadCsv(); }) });
      m.push({ icon: 'toc', label: 'Separator kolumn…', onClick: chooseSep });
    }
    return m;
  },
});

/* ---------- formatowanie wartości ---------- */
function plNumber(w) {
  return w.replace(/[\d.,]+/g, (m) => (/\d/.test(m) ? m.replace(/,/g, ' ').replace(/\./g, ',') : m));
}

function cellText(c) {
  if (!c) return '';
  if (showFormulas && c.f) return '=' + c.f;
  switch (c.t) {
    case 'z': return '';
    case 'b': return c.v ? 'PRAWDA' : 'FAŁSZ';
    case 'e': return c.w || '#BŁĄD';
    case 'n': {
      let w = c.w;
      if (w == null) { try { w = XLSX.SSF.format(c.z || 'General', c.v); } catch (e) { w = String(c.v); } }
      if (c.z && XLSX.SSF.is_date(c.z)) return w;
      return plNumber(String(w));
    }
    case 'd': return c.w || (c.v instanceof Date ? c.v.toLocaleDateString('pl-PL') : String(c.v));
    default: return c.w != null ? String(c.w) : (c.v == null ? '' : String(c.v));
  }
}

const hasValue = (c) => c && ((c.v !== undefined && c.v !== null && c.v !== '') || c.f);
const colName = (c) => XLSX.utils.encode_col(c);

/* ---------- wczytanie skoroszytu ---------- */
function detectSep(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  let best = ',', bestScore = -1;
  for (const sep of [';', ',', '\t', '|']) {
    const counts = lines.map((l) => {
      let n = 0, q = false;
      for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) n++; }
      return n;
    });
    const freq = {};
    for (const n of counts) if (n > 0) freq[n] = (freq[n] || 0) + 1;
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    const score = top ? top[1] * 100 + Number(top[0]) : 0;
    if (score > bestScore) { bestScore = score; best = sep; }
  }
  return best;
}

function loadCsv() {
  const { text, enc } = decodeText(raw, csvEnc);
  csvEnc = enc;
  const sep = csvSep || detectSep(text);
  csvSep = sep;
  wb = XLSX.read(text, { type: 'string', raw: true, dense: true, FS: sep });
  showWorkbook();
  UI.toast(`Kodowanie ${encodingLabel(enc)}, separator „${sep === '\t' ? 'Tab' : sep}”`, 2000);
}

function chooseSep() {
  const list = h('div', { class: 'list' });
  let d;
  for (const [s, label] of [[';', 'Średnik ;'], [',', 'Przecinek ,'], ['\t', 'Tabulator'], ['|', 'Kreska |']]) {
    list.append(h('button', { text: (s === csvSep ? '✓ ' : '') + label, onclick: () => { d.close(); csvSep = s; loadCsv(); } }));
  }
  d = UI.dialog({ title: 'Separator kolumn', body: list, buttons: [{ label: 'Anuluj' }] });
}

function sheetHidden(i) {
  const m = wb.Workbook && wb.Workbook.Sheets && wb.Workbook.Sheets[i];
  return !!(m && m.Hidden);
}

function showWorkbook() {
  tabsEl.innerHTML = '';
  const names = wb.SheetNames;
  if (names.length > 1) {
    names.forEach((n, i) => {
      tabsEl.append(h('button', { class: sheetHidden(i) ? 'hid' : '', text: n, title: sheetHidden(i) ? 'Arkusz ukryty' : n, onclick: () => openSheet(i) }));
    });
    tabsEl.hidden = false;
    document.body.style.setProperty('--tabs-h', '46px');
  } else {
    tabsEl.hidden = true;
    document.body.style.setProperty('--tabs-h', '0px');
  }
  let first = names.findIndex((_, i) => !sheetHidden(i));
  const active = wb.Workbook && wb.Workbook.WBView && wb.Workbook.WBView[0] && wb.Workbook.WBView[0].activeTab;
  if (active != null && active < names.length && !sheetHidden(active)) first = active;
  openSheet(Math.max(0, first));
}

/* ---------- rysowanie arkusza ---------- */
function openSheet(i) {
  if (finder) finder.close();
  selectCell(null);
  cur = i;
  const name = wb.SheetNames[i];
  const ws = wb.Sheets[name];
  [...tabsEl.children].forEach((b, k) => b.classList.toggle('on', k === i));
  if (tabsEl.children[i]) tabsEl.children[i].scrollIntoView({ inline: 'nearest', block: 'nearest' });

  const data = ws['!data'] || [];
  let r1 = -1, c1 = -1;
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    if (!row) continue;
    for (let c = row.length - 1; c >= 0; c--) {
      if (hasValue(row[c])) { if (r > r1) r1 = r; if (c > c1) c1 = c; break; }
    }
  }
  const merges = ws['!merges'] || [];
  for (const m of merges) {
    if (m.s.r <= r1 + 1 && m.s.c <= c1 + 1) { r1 = Math.max(r1, m.e.r); c1 = Math.max(c1, m.e.c); }
  }
  c1 = Math.min(c1, 1023);

  const colsInfo = ws['!cols'] || [];
  const rowsInfo = ws['!rows'] || [];
  const visCols = [];
  for (let c = 0; c <= c1; c++) if (!(colsInfo[c] && colsInfo[c].hidden)) visCols.push(c);
  const colPx = (c) => {
    const ci = colsInfo[c];
    let w = ci ? (ci.wpx || (ci.wch ? ci.wch * 7 + 5 : ci.width ? ci.width * 7 + 5 : 0)) : 0;
    if (!w) w = isCsv ? 110 : 76;
    return Math.max(18, Math.min(600, Math.round(w)));
  };

  // scalone komórki
  const mergeAt = new Map(), covered = new Set();
  for (const m of merges) {
    const cs = visCols.filter((c) => c >= m.s.c && c <= m.e.c).length;
    let rs = 0;
    for (let r = m.s.r; r <= m.e.r; r++) if (!(rowsInfo[r] && rowsInfo[r].hidden)) rs++;
    if (cs < 1 || rs < 1) continue;
    mergeAt.set(m.s.r + ',' + m.s.c, { cs, rs, e: m.e });
    for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(r + ',' + c);
  }

  content.innerHTML = '';
  zp.setZoom(1, 0, 0);
  scroller.scrollTop = 0;
  scroller.scrollLeft = 0;

  const rows = r1 + 1, cols = visCols.length;
  UI.setSub(wb.SheetNames.length > 1 || !isCsv
    ? `${name} · ${rows.toLocaleString('pl-PL')} ${plPlural(rows, 'wiersz', 'wiersze', 'wierszy')}`
    : `${rows.toLocaleString('pl-PL')} ${plPlural(rows, 'wiersz', 'wiersze', 'wierszy')} · ${cols} ${plPlural(cols, 'kolumna', 'kolumny', 'kolumn')}`);

  if (r1 < 0) {
    content.append(h('div', { class: 'empty', text: 'Ten arkusz jest pusty.' }));
    S = null;
    return;
  }

  const table = h('table', { class: 'grid' });
  const cg = h('colgroup', null, h('col', { style: `width:${Math.max(36, String(r1 + 1).length * 8 + 14)}px` }));
  for (const c of visCols) cg.append(h('col', { style: `width:${colPx(c)}px` }));
  const thr = h('tr', null, h('th', { class: 'corner' }));
  for (const c of visCols) thr.append(h('th', { text: colName(c) }));
  table.append(cg, h('thead', null, thr));
  const tbody = h('tbody');
  table.append(tbody);
  content.append(table);

  S = { ws, data, r1, c1, visCols, rowsInfo, mergeAt, covered, tbody, done: 0, cells: new Map(), sentinel: null, io: null };
  renderMore();
  table.addEventListener('click', (e) => {
    const td = e.target.closest('td');
    if (td && td.dataset.rc) selectCell(td);
  });
}

function renderMore(untilRow) {
  if (!S) return;
  const { data, r1, visCols, rowsInfo, mergeAt, covered, tbody } = S;
  const end = Math.min(r1, Math.max(S.done + CHUNK - 1, untilRow == null ? 0 : untilRow + 60));
  if (S.sentinel) { S.sentinel.remove(); S.sentinel = null; }
  const frag = document.createDocumentFragment();
  for (let r = S.done; r <= end; r++) {
    const ri = rowsInfo[r];
    if (ri && ri.hidden) continue;
    const tall = ri && (ri.hpx || (ri.hpt ? ri.hpt * 4 / 3 : 0)) > 26;
    const tr = h('tr');
    if (ri && (ri.hpx || ri.hpt)) tr.style.height = Math.round(ri.hpx || ri.hpt * 4 / 3) + 'px';
    tr.append(h('th', { text: String(r + 1) }));
    const row = data[r] || [];
    for (let k = 0; k < visCols.length; k++) {
      const c = visCols[k];
      const key = r + ',' + c;
      if (covered.has(key)) continue;
      const cell = row[c];
      const td = document.createElement('td');
      td.dataset.rc = key;
      const txt = cellText(cell);
      if (txt) {
        td.textContent = txt;
        const t = cell.t;
        if (t === 'n' && !(showFormulas && cell.f)) td.className = 'n';
        else if (isCsv && /\d/.test(txt) && /^[-+]?[\d\s\u00a0.,]+%?$/.test(txt.trim())) td.className = 'n';
        else if (t === 'b' || t === 'e') td.className = t;
        if (txt.includes('\n')) td.classList.add('ml');
        else if (tall && txt.length > 12) td.classList.add('wrap');
        else if (t !== 'n') {
          // długi tekst „wylewa się” na puste komórki po prawej, jak w Excelu
          const nx = visCols[k + 1];
          if (nx !== undefined && !hasValue(row[nx]) && !covered.has(r + ',' + nx)) td.classList.add('spill');
        }
      }
      const s = cell && cell.s;
      if (s && s.patternType === 'solid' && s.fgColor && s.fgColor.rgb && !/^(FF)?FFFFFF$/i.test(s.fgColor.rgb)) {
        td.style.background = '#' + s.fgColor.rgb.slice(-6);
      }
      const m = mergeAt.get(key);
      if (m) {
        if (m.cs > 1) td.colSpan = m.cs;
        if (m.rs > 1) td.rowSpan = m.rs;
        td.classList.remove('spill');
        if (m.rs > 1) td.style.verticalAlign = 'middle';
        if (m.cs > 1 && (!cell || cell.t !== 'n')) td.style.textAlign = 'center';
      }
      S.cells.set(key, td);
      tr.append(td);
    }
    frag.append(tr);
  }
  tbody.append(frag);
  S.done = end + 1;
  if (S.done <= r1) {
    const tr = h('tr', { class: 'more' }, h('td', { colspan: String(visCols.length + 1), text: 'Wczytywanie kolejnych wierszy…' }));
    tbody.append(tr);
    S.sentinel = tr;
    if (!S.io) S.io = new IntersectionObserver((en) => { if (en.some((e) => e.isIntersecting)) renderMore(); }, { root: scroller, rootMargin: '800px' });
    S.io.observe(tr);
  }
}

function ensureRow(r) { if (S && r >= S.done) renderMore(r); }

/* ---------- zaznaczanie komórki ---------- */
let selTd = null;
function selectCell(td) {
  if (selTd) selTd.classList.remove('sel');
  selTd = td;
  if (!td) {
    info.hidden = true;
    document.body.style.setProperty('--info-h', '0px');
    return;
  }
  td.classList.add('sel');
  const [r, c] = td.dataset.rc.split(',').map(Number);
  const cell = (S.data[r] || [])[c];
  document.getElementById('ciAddr').textContent = colName(c) + (r + 1);
  const saved = showFormulas;
  showFormulas = false;
  document.getElementById('ciVal').textContent = cellText(cell) || '(pusta)';
  showFormulas = saved;
  document.getElementById('ciF').textContent = cell && cell.f ? '=' + cell.f : '';
  info.hidden = false;
  document.body.style.setProperty('--info-h', info.offsetHeight + 'px');
}

window.onBackExtra = () => { if (selTd) { selectCell(null); return true; } return false; };

function showCell(r, c) {
  ensureRow(r);
  const td = S.cells.get(r + ',' + c);
  if (!td) return null;
  td.scrollIntoView({ block: 'center', inline: 'center' });
  return td;
}

async function gotoCell() {
  if (!S) return;
  const v = await UI.prompt({
    title: 'Przejdź do komórki', label: 'Adres komórki, np. B12', placeholder: 'A1', okLabel: 'Przejdź',
    validate: (s) => (/^\s*[A-Za-z]{1,3}\s*\d{1,7}\s*$/.test(s) ? null : 'Wpisz adres w postaci litera + numer, np. C25'),
  });
  if (v == null) return;
  const a = XLSX.utils.decode_cell(v.replace(/\s/g, '').toUpperCase());
  const td = showCell(Math.min(a.r, S.r1), a.c);
  if (td) selectCell(td);
  else UI.toast('Ta komórka jest poza zakresem danych');
}

/* ---------- szukanie ---------- */
function clearHits() {
  for (const hh of hits) { const td = S && S.cells.get(hh); if (td) td.classList.remove('hit', 'cur'); }
  hits = [];
  hitIdx = -1;
}
function runSearch(q) {
  clearHits();
  if (!q || !S) return 0;
  const needle = foldText(q);
  for (let r = 0; r <= S.r1 && hits.length < 5000; r++) {
    const row = S.data[r];
    if (!row) continue;
    for (const c of S.visCols) {
      if (S.covered.has(r + ',' + c)) continue;
      const t = cellText(row[c]);
      if (t && foldText(t).includes(needle)) hits.push(r + ',' + c);
    }
  }
  if (hits.length) goHit(0);
  return hits.length;
}
function goHit(i) {
  if (!hits.length) return;
  const prev = hits[hitIdx] && S.cells.get(hits[hitIdx]);
  if (prev) prev.classList.remove('cur');
  hitIdx = (i + hits.length) % hits.length;
  const [r, c] = hits[hitIdx].split(',').map(Number);
  showCell(r, c);
  for (const k of hits) { const td = S.cells.get(k); if (td) td.classList.add('hit'); }
  const td = S.cells.get(hits[hitIdx]);
  if (td) td.classList.add('cur');
}
function openFind() {
  finder = UI.find({
    placeholder: 'Szukaj w arkuszu',
    onSearch: (q) => { const n = runSearch(q); finder.count(n ? 1 : 0, n); },
    onNext: () => { goHit(hitIdx + 1); finder.count(hitIdx + 1, hits.length); },
    onPrev: () => { goHit(hitIdx - 1); finder.count(hitIdx + 1, hits.length); },
    onClose: () => { clearHits(); finder = null; },
  });
}

UI.extraInfo = () => {
  if (!wb) return [];
  const rows = [['Arkusze', String(wb.SheetNames.length)]];
  if (isCsv) rows.push(['Kodowanie', encodingLabel(csvEnc)], ['Separator', csvSep === '\t' ? 'Tab' : csvSep]);
  return rows;
};

/* ---------- start ---------- */
(async () => {
  UI.loading('Otwieranie arkusza…');
  try {
    raw = await UI.fetchFile();
    UI.loading('Wczytuję dane…');
    await new Promise((r) => setTimeout(r, 20));
    if (isCsv) loadCsv();
    else {
      wb = XLSX.read(new Uint8Array(raw), { type: 'array', dense: true, cellNF: true, cellStyles: true, cellDates: false });
      showWorkbook();
    }
    UI.done();
  } catch (e) {
    console.error(e);
    const msg = String(e && e.message || e);
    if (/password|encrypt/i.test(msg)) UI.fail('Plik chroniony hasłem', 'Tego arkusza nie da się otworzyć bez hasła.', { icon: 'lock' });
    else UI.fail('Nie udało się otworzyć arkusza', 'Plik może być uszkodzony albo w nieobsługiwanym formacie. (' + msg + ')');
  }
})();
