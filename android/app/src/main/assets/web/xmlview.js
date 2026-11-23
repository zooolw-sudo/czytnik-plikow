/*
 * Przeglądarka XML: drzewo ze zwijaniem gałęzi, sformatowany tekst z kolorami,
 * a dla e-faktur z KSeF (FA(2), FA(3)) – czytelny widok faktury.
 */
'use strict';

const main = document.getElementById('main');
const box = document.getElementById('box');
const tabs = document.getElementById('tabs2');
const zp = new ZoomPane(main, box, { min: 0.5, max: 4, fit: () => 1 });
const search = new DomSearch(box, main);

let raw = null, xmlDoc = null, enc = null, view = 'tree', invoice = null, finder = null;
let treeAll = false;

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Kodowanie z deklaracji <?xml … encoding="…"?>, gdy plik nie jest w UTF-8. */
function decodeXml(buf, forced) {
  if (forced) return decodeText(buf, forced);
  const head = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 300)));
  const m = /^\s*<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head.replace(/^\uFEFF|^ï»¿/, ''));
  if (m && !/^utf-?8$/i.test(m[1])) {
    try { return { text: new TextDecoder(m[1].toLowerCase()).decode(buf), enc: m[1].toLowerCase() }; } catch (e) { /* nieznane – zgadujemy */ }
  }
  return decodeText(buf);
}

/* ---------- drzewo ---------- */
function attrsHtml(el) {
  let s = '';
  for (const a of el.attributes) s += ` <span class="a">${esc(a.name)}</span><span class="p">=</span><span class="v">"${esc(a.value)}"</span>`;
  return s;
}

function elementKids(el) {
  return Array.from(el.childNodes).filter((n) => n.nodeType === 1 || n.nodeType === 8 || ((n.nodeType === 3 || n.nodeType === 4) && n.data.trim()));
}

function nodeEl(n, depth) {
  if (n.nodeType === 8) return h('div', { class: 'n' }, h('div', { class: 'row c', text: `<!-- ${n.data.trim()} -->` }));
  if (n.nodeType === 3 || n.nodeType === 4) return h('div', { class: 'n' }, h('div', { class: 'row tx', text: n.data.trim() }));
  const kids = elementKids(n);
  const name = esc(n.tagName);
  const wrap = h('div', { class: 'n' });
  const onlyText = kids.every((k) => k.nodeType === 3 || k.nodeType === 4);
  if (!kids.length) {
    wrap.append(h('div', { class: 'row', html: `<span class="p">&lt;</span><span class="t">${name}</span>${attrsHtml(n)}<span class="p">/&gt;</span>` }));
    return wrap;
  }
  if (onlyText) {
    const txt = kids.map((k) => k.data).join('').trim();
    wrap.append(h('div', { class: 'row', html: `<span class="p">&lt;</span><span class="t">${name}</span>${attrsHtml(n)}<span class="p">&gt;</span><span class="tx">${esc(txt)}</span><span class="p">&lt;/</span><span class="t">${name}</span><span class="p">&gt;</span>` }));
    return wrap;
  }
  const tg = h('span', { class: 'tg', text: '▾' });
  const open = h('div', { class: 'row', html: `<span class="p">&lt;</span><span class="t">${name}</span>${attrsHtml(n)}<span class="p">&gt;</span>` });
  const childBox = h('div', { class: 'kids' });
  const close = h('div', { class: 'row', html: `<span class="p">&lt;/</span><span class="t">${name}</span><span class="p">&gt;</span>` });
  let rendered = false;
  const render = () => {
    if (rendered) return;
    rendered = true;
    const LIMIT = 400;
    const add = (from) => {
      const frag = document.createDocumentFragment();
      for (let i = from; i < Math.min(kids.length, from + LIMIT); i++) frag.append(nodeEl(kids[i], depth + 1));
      childBox.append(frag);
      if (from + LIMIT < kids.length) {
        const more = h('div', { class: 'more', text: `… pokaż kolejne (${kids.length - from - LIMIT})` });
        more.onclick = () => { more.remove(); add(from + LIMIT); };
        childBox.append(more);
      }
    };
    add(0);
  };
  const setOpen = (o) => {
    if (o) render();
    childBox.hidden = !o;
    close.hidden = !o;
    tg.textContent = o ? '▾' : '▸';
    open.dataset.closed = o ? '' : '1';
    if (!o) open.insertAdjacentHTML('beforeend', `<span class="p" data-dots> … &lt;/</span><span class="t" data-dots>${name}</span><span class="p" data-dots>&gt;</span>`);
    else open.querySelectorAll('[data-dots]').forEach((d) => d.remove());
  };
  tg.onclick = () => setOpen(childBox.hidden);
  open.onclick = (e) => { if (e.target === open || e.target.classList.contains('t')) setOpen(childBox.hidden); };
  wrap.append(tg, open, childBox, close);
  wrap._setOpen = setOpen;
  setOpen(treeAll || depth < 3);
  return wrap;
}

function showTree() {
  box.innerHTML = '';
  const root = h('div', { class: 'xml' });
  for (const n of Array.from(xmlDoc.childNodes)) {
    if (n.nodeType === 1 || n.nodeType === 8) root.append(nodeEl(n, 0));
  }
  box.append(root);
}

/* ---------- sformatowany tekst ---------- */
function prettyHtml(n, ind, out) {
  if (out.len > 6e6) return;
  const pad = '  '.repeat(ind);
  let s;
  if (n.nodeType === 8) s = `${pad}<span class="c">&lt;!-- ${esc(n.data.trim())} --&gt;</span>\n`;
  else if (n.nodeType === 3 || n.nodeType === 4) s = n.data.trim() ? `${pad}<span class="tx">${esc(n.data.trim())}</span>\n` : '';
  else if (n.nodeType === 1) {
    const name = esc(n.tagName);
    const kids = elementKids(n);
    const openTag = `<span class="p">&lt;</span><span class="t">${name}</span>${attrsHtml(n)}`;
    if (!kids.length) s = `${pad}${openTag}<span class="p">/&gt;</span>\n`;
    else if (kids.every((k) => k.nodeType === 3 || k.nodeType === 4)) {
      s = `${pad}${openTag}<span class="p">&gt;</span><span class="tx">${esc(kids.map((k) => k.data).join('').trim())}</span><span class="p">&lt;/</span><span class="t">${name}</span><span class="p">&gt;</span>\n`;
    } else {
      out.parts.push(`${pad}${openTag}<span class="p">&gt;</span>\n`);
      for (const k of kids) prettyHtml(k, ind + 1, out);
      s = `${pad}<span class="p">&lt;/</span><span class="t">${name}</span><span class="p">&gt;</span>\n`;
    }
  } else s = '';
  out.parts.push(s);
  out.len += s.length;
}

function showText() {
  const out = { parts: [], len: 0 };
  for (const n of Array.from(xmlDoc.childNodes)) prettyHtml(n, 0, out);
  box.innerHTML = '';
  const pre = h('pre', { class: 'xml xml-text', html: out.parts.join('') });
  box.append(pre);
  if (out.len > 6e6) box.append(h('div', { class: 'note', text: 'Plik jest bardzo duży – pokazano tylko jego początek.' }));
}

/* ---------- przełączanie widoków ---------- */
function setView(v) {
  if (finder) finder.close();
  view = v;
  zp.setZoom(1, 0, 0);
  main.scrollTop = 0;
  main.style.background = '';
  if (v === 'invoice') Ksef.render(invoice, box);
  else if (v === 'text') showText();
  else showTree();
  [...tabs.children].forEach((b) => b.classList.toggle('on', b.dataset.v === v || (v === 'text' && b.dataset.v === 'tree')));
}
tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); });

function openFind() {
  if (view === 'tree' && !treeAll) { treeAll = true; showTree(); }
  finder = UI.find({
    placeholder: view === 'invoice' ? 'Szukaj na fakturze' : 'Szukaj w XML',
    onSearch: (q) => { const n = search.run(q); finder.count(n ? 1 : 0, n); },
    onNext: () => { search.next(); finder.count(search.cur + 1, search.hits.length); },
    onPrev: () => { search.prev(); finder.count(search.cur + 1, search.hits.length); },
    onClose: () => { search.clear(); finder = null; },
  });
}

UI.bar({
  actions: [{ icon: 'search', label: 'Szukaj', onClick: openFind }],
  menu: () => {
    const m = [];
    if (invoice) m.push({ icon: 'file', label: 'Widok faktury', checked: view === 'invoice', onClick: () => setView('invoice') });
    m.push(
      { icon: 'toc', label: 'Drzewo XML', checked: view === 'tree', onClick: () => setView('tree') },
      { icon: 'text', label: 'Tekst XML', checked: view === 'text', onClick: () => setView('text') });
    if (view === 'tree') {
      m.push({ icon: 'down', label: 'Rozwiń wszystko', onClick: () => { treeAll = true; showTree(); } });
      m.push({ icon: 'up', label: 'Zwiń wszystko', onClick: () => { treeAll = false; box.querySelectorAll('.n').forEach((n) => n._setOpen && n._setOpen(false)); } });
    }
    m.push({ icon: 'wrap', label: 'Kodowanie znaków…', onClick: () => chooseEncoding(enc, (e) => { enc = e; load(e); }) });
    return m;
  },
});

function load(forcedEnc) {
  const r = decodeXml(raw, forcedEnc);
  enc = r.enc;
  const text = r.text.replace(/^\uFEFF/, '');
  xmlDoc = new DOMParser().parseFromString(text, 'application/xml');
  const err = xmlDoc.getElementsByTagName('parsererror')[0];
  if (err) {
    xmlDoc = null;
    box.innerHTML = '';
    box.append(h('div', { class: 'note err', text: 'Plik nie jest poprawnym XML – pokazuję go jako zwykły tekst. ' + (err.textContent || '').split('\n')[0] }));
    box.append(h('pre', { class: 'xml xml-text', text }));
    UI.setSub('XML z błędami · ' + encodingLabel(enc));
    return;
  }
  invoice = Ksef.detect(xmlDoc) ? xmlDoc : null;
  tabs.hidden = !invoice;
  document.body.classList.toggle('has-tabs', !!invoice);
  const count = xmlDoc.getElementsByTagName('*').length;
  treeAll = count < 300;
  if (invoice) {
    UI.setSub('E-faktura KSeF · ' + Ksef.version(xmlDoc));
    setView('invoice');
  } else {
    UI.setSub(`XML · ${count.toLocaleString('pl-PL')} ${plPlural(count, 'element', 'elementy', 'elementów')} · ${encodingLabel(enc)}`);
    setView('tree');
  }
}

UI.extraInfo = () => (invoice ? Ksef.info(invoice) : []);

(async () => {
  UI.loading('Otwieranie XML…');
  try {
    raw = await UI.fetchFile();
    load();
    UI.done();
  } catch (e) {
    console.error(e);
    UI.fail('Nie udało się otworzyć pliku', String(e && e.message || e));
  }
})();
