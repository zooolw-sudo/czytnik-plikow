/*
 * Wspólne elementy wszystkich ekranów: górny pasek, menu, okna, wyszukiwanie,
 * ładowanie pliku, powiększanie dwoma palcami i most do części Android (window.App).
 */
'use strict';

const Bridge = window.App || null;
const Q = new URLSearchParams(location.search);
const FILE = {
  src: Q.get('src'),
  name: Q.get('name') || 'Plik',
  type: Q.get('type') || '',
  size: Number(Q.get('size')) || 0,
};

const ICONS = {
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  more: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  up: 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z',
  down: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z',
  share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 21 5a3 3 0 1 0-5.91.7L8.04 9.81A2.99 2.99 0 0 0 3 12a2.99 2.99 0 0 0 5.04 2.19l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08z',
  openWith: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  toc: 'M3 9h14V7H3v2zm0 4h14v-2H3v2zm0 4h14v-2H3v2zm16 0h2v-2h-2v2zm0-10v2h2V7h-2zm0 6h2v-2h-2v2z',
  folder: 'M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z',
  file: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  text: 'M2.5 4v3h5v12h3V7h5V4h-13zm19 5h-9v3h3v7h3v-7h3V9z',
  page: 'M6 2c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z',
  fit: 'M9 3 5 7l4 4V8h6v3l4-4-4-4v3H9zm-6 9v8h18v-8h-2v6H5v-6z',
  goto: 'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z',
  wrap: 'M4 19h6v-2H4v2zM20 5H4v2h16V5zm-3 6H4v2h13.25c1.1 0 2 .9 2 2s-.9 2-2 2H15v-2l-3 3 3 3v-2h2c2.21 0 4-1.79 4-4s-1.79-4-4-4z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z',
  warn: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  attach: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z',
  sign: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  chart: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
}

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return e;
}

function plPlural(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n === 1) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

/** Porównywanie przy szukaniu: bez wielkości liter i bez polskich znaków (ż = z, ł = l). */
function foldChar(c) {
  if (c === 'ł' || c === 'Ł') return 'l';
  const d = c.normalize('NFD');
  return (d.length > 1 ? d[0] : c).toLowerCase();
}
function foldText(s) {
  let out = '';
  for (const c of s) out += c.length === 1 ? foldChar(c) : c;
  return out;
}

const UI = {
  overlays: [],
  barEl: null,
  menuItems: null,

  /** Górny pasek: strzałka wstecz, nazwa pliku, podtytuł, przyciski i menu „⋮”. */
  bar({ actions = [], menu = null, home = false } = {}) {
    const bar = h('header', { class: 'bar' });
    if (!home) {
      bar.append(h('button', { class: 'ibtn', 'aria-label': 'Wstecz', html: icon('back'), onclick: () => UI.goBack() }));
    }
    const title = h('div', { class: 'title' },
      h('div', { class: 'name', id: 'barName', text: home ? 'Czytnik plików' : FILE.name }),
      h('div', { class: 'sub', id: 'barSub' }));
    bar.append(title);
    for (const a of actions) {
      const b = h('button', { class: 'ibtn', 'aria-label': a.label, title: a.label, html: icon(a.icon), onclick: a.onClick });
      if (a.id) b.id = a.id;
      bar.append(b);
    }
    this.menuItems = menu;
    if (menu || !home) {
      bar.append(h('button', { class: 'ibtn', 'aria-label': 'Więcej', html: icon('more'), onclick: () => UI.openMenu(UI.fullMenu()) }));
    }
    document.body.prepend(bar);
    this.barEl = bar;
    if (Bridge && Bridge.setTitle) Bridge.setTitle(home ? 'Czytnik plików' : FILE.name);
    return bar;
  },

  fullMenu() {
    const own = typeof this.menuItems === 'function' ? this.menuItems() : (this.menuItems || []);
    const items = [...own];
    if (FILE.src) {
      if (items.length) items.push('-');
      items.push({ icon: 'share', label: 'Udostępnij', onClick: () => UI.share() });
      items.push({ icon: 'openWith', label: 'Otwórz w innej aplikacji', onClick: () => UI.openWith() });
      items.push({ icon: 'info', label: 'Informacje o pliku', onClick: () => UI.fileInfo() });
    }
    return items;
  },

  setSub(text, onTap) {
    const s = document.getElementById('barSub');
    if (!s) return;
    s.textContent = text || '';
    s.classList.toggle('tap', !!onTap);
    s.onclick = onTap || null;
  },

  goBack() {
    if (Bridge) Bridge.back();
    else history.back();
  },

  share() { Bridge ? Bridge.share() : UI.toast('Udostępnianie działa w aplikacji'); },
  openWith() { Bridge ? Bridge.openWith() : UI.toast('Działa w aplikacji'); },

  fileInfo(extra = []) {
    let info = { name: FILE.name, size: FILE.size };
    if (Bridge && Bridge.fileInfo) {
      try { info = Object.assign(info, JSON.parse(Bridge.fileInfo())); } catch (e) { /* zostają dane z adresu */ }
    }
    const rows = [['Nazwa', info.name], ['Rozmiar', info.size ? UI.formatSize(info.size) : '—']];
    if (info.mime) rows.push(['Typ', info.mime]);
    if (info.modified) rows.push(['Zmieniony', new Date(info.modified).toLocaleString('pl-PL')]);
    if (info.source) rows.push(['Skąd', info.source]);
    for (const r of (UI.extraInfo ? UI.extraInfo() : [])) rows.push(r);
    for (const r of extra) rows.push(r);
    const dl = h('dl', { class: 'kv' });
    for (const [k, v] of rows) dl.append(h('dt', { text: k }), h('dd', { text: v }));
    UI.dialog({ title: 'Informacje o pliku', body: dl, buttons: [{ label: 'Zamknij', primary: true }] });
  },

  /* ---------- nakładki zamykane przyciskiem Wstecz ---------- */
  /** Informuje część Android, czy Wstecz ma najpierw zamknąć nakładkę (Android 13+). */
  syncBack() {
    if (Bridge && Bridge.setOverlayOpen) Bridge.setOverlayOpen(this.overlays.length > 0);
  },

  pushOverlay(close) {
    this.overlays.push(close);
    this.syncBack();
    return () => {
      const i = this.overlays.indexOf(close);
      if (i >= 0) this.overlays.splice(i, 1);
      this.syncBack();
    };
  },

  openMenu(items) {
    if (!items.length) return;
    const scrim = h('div', { class: 'scrim' });
    const menu = h('div', { class: 'menu', role: 'menu' });
    let pop;
    const close = () => { scrim.remove(); menu.remove(); pop(); };
    pop = UI.pushOverlay(close);
    scrim.addEventListener('click', close);
    for (const it of items) {
      if (it === '-') { menu.append(h('hr')); continue; }
      const b = h('button', { role: 'menuitem', onclick: () => { close(); it.onClick(); } });
      if (it.icon) b.insertAdjacentHTML('beforeend', icon(it.icon));
      b.append(it.label);
      if (it.checked) b.append(h('span', { class: 'check', text: '✓' }));
      menu.append(b);
    }
    document.body.append(scrim, menu);
  },

  /** Okno dialogowe. Przycisk z action zwracającym false nie zamyka okna. */
  dialog({ title, body, buttons = [{ label: 'OK', primary: true }], onClose, dismissable = true }) {
    const scrim = h('div', { class: 'scrim dim' });
    const box = h('div', { class: 'dialog', role: 'dialog' });
    if (title) box.append(h('h3', { text: title }));
    const bodyEl = h('div', { class: 'body' });
    if (typeof body === 'string') bodyEl.textContent = body; else if (body) bodyEl.append(body);
    box.append(bodyEl);
    const btns = h('div', { class: 'buttons' });
    let closed = false, pop;
    const close = (val) => {
      if (closed) return;
      closed = true; scrim.remove(); box.remove(); pop();
      if (onClose) onClose(val);
    };
    pop = UI.pushOverlay(() => { if (dismissable) close(null); });
    for (const b of buttons) {
      btns.append(h('button', {
        class: b.primary ? 'primary' : '',
        text: b.label,
        onclick: async () => {
          const r = b.action ? await b.action() : undefined;
          if (r !== false) close(b.value !== undefined ? b.value : r);
        },
      }));
    }
    if (buttons.length) box.append(btns);
    if (dismissable) scrim.addEventListener('click', () => close(null));
    document.body.append(scrim, box);
    return { close, box, body: bodyEl };
  },

  /** Pytanie o tekst/liczbę. Zwraca Promise z wpisaną wartością albo null. */
  prompt({ title, label = '', value = '', type = 'text', placeholder = '', okLabel = 'OK', validate }) {
    return new Promise((resolve) => {
      const input = h('input', { type, value, placeholder, autocomplete: 'off', enterkeyhint: 'done' });
      if (type === 'number') input.setAttribute('inputmode', 'numeric');
      const err = h('div', { class: 'error' });
      const body = h('div', null, label ? h('div', { text: label }) : null, input, err);
      let d;
      const ok = () => {
        const v = input.value;
        const msg = validate ? validate(v) : null;
        if (msg) { err.textContent = msg; return false; }
        return v;
      };
      d = UI.dialog({
        title, body, onClose: (v) => resolve(v == null ? null : v),
        buttons: [{ label: 'Anuluj', value: null }, { label: okLabel, primary: true, action: ok }],
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const v = ok(); if (v !== false) d.close(v); }
      });
      setTimeout(() => { input.focus(); input.select(); }, 60);
    });
  },

  toast(msg, ms = 2600) {
    const t = h('div', { class: 'toast', text: msg });
    document.body.append(t);
    setTimeout(() => t.remove(), ms);
  },

  /* ---------- stan ładowania ---------- */
  stateEl: null,
  loading(msg = 'Otwieranie…') {
    if (!this.stateEl) { this.stateEl = h('div', { class: 'state' }); document.body.append(this.stateEl); }
    this.stateEl.hidden = false;
    this.stateEl.innerHTML = '';
    this.stateEl.append(h('div', { class: 'spinner' }), h('div', { class: 'msg', text: msg }),
      h('div', { class: 'progress', hidden: true }, h('div')));
  },
  progress(frac) {
    if (!this.stateEl) return;
    const p = this.stateEl.querySelector('.progress');
    if (!p) return;
    p.hidden = false;
    p.firstChild.style.width = Math.round(Math.min(1, frac) * 100) + '%';
  },
  done() { if (this.stateEl) this.stateEl.hidden = true; },
  fail(title, msg, { canOpenWith = true, icon: ico = 'warn' } = {}) {
    UI.loading();
    const s = this.stateEl;
    s.innerHTML = '';
    s.append(h('div', { class: 'big-ico', html: icon(ico) }), h('h2', { text: title }));
    if (msg) s.append(h('div', { class: 'msg', text: msg }));
    const row = h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:6px' });
    if (canOpenWith && Bridge) row.append(h('button', { class: 'btn', html: icon('openWith') + 'Otwórz w innej aplikacji', onclick: () => UI.openWith() }));
    row.append(h('button', { class: 'btn ghost', text: 'Wróć', onclick: () => UI.goBack() }));
    s.append(row);
  },

  /** Wczytuje cały plik jako ArrayBuffer (z paskiem postępu). */
  async fetchFile() {
    const res = await fetch(FILE.src);
    if (!res.ok) throw new Error(res.status === 404 ? 'Plik jest już niedostępny.' : 'Błąd odczytu (' + res.status + ')');
    const total = Number(res.headers.get('Content-Length')) || FILE.size || 0;
    if (!res.body || !res.body.getReader || !total) return await res.arrayBuffer();
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      UI.progress(got / total);
    }
    const out = new Uint8Array(got);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out.buffer;
  },

  formatSize(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toLocaleString('pl-PL', { maximumFractionDigits: n < 10 ? 1 : 0 }) + ' ' + u[i];
  },

  /** Otwiera plik zapisany w base64 (np. załącznik w XML) jako plik podrzędny. */
  openBase64(name, b64, source) {
    if (!Bridge || !Bridge.childBegin) { UI.toast('Otwieranie plików działa w aplikacji'); return; }
    UI.loading(`Otwieranie „${name}”…`);
    setTimeout(() => {
      const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
      Bridge.childBegin(name, source || 'Plik z ' + FILE.name);
      const CH = 1024 * 1024; // wielokrotność 4 – każdy kawałek dekoduje się osobno
      for (let i = 0; i < clean.length; i += CH) Bridge.childChunk(clean.slice(i, i + CH));
      Bridge.childEnd();
    }, 40);
  },

  store: {
    get(k, d) { try { const v = localStorage.getItem('cz.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('cz.' + k, JSON.stringify(v)); } catch (e) { /* bez zapamiętywania */ } },
  },

  /* ---------- pasek wyszukiwania ---------- */
  find({ onSearch, onNext, onPrev, onClose, placeholder = 'Szukaj w pliku' }) {
    let fb = this.barEl.querySelector('.findbar');
    if (!fb) {
      fb = h('div', { class: 'findbar' },
        h('button', { class: 'ibtn', 'aria-label': 'Zamknij szukanie', html: icon('back'), 'data-act': 'close' }),
        h('input', { type: 'search', placeholder, enterkeyhint: 'search', autocomplete: 'off' }),
        h('span', { class: 'count' }),
        h('button', { class: 'ibtn', 'aria-label': 'Poprzedni', html: icon('up'), 'data-act': 'prev' }),
        h('button', { class: 'ibtn', 'aria-label': 'Następny', html: icon('down'), 'data-act': 'next' }));
      this.barEl.append(fb);
    }
    const input = fb.querySelector('input');
    const count = fb.querySelector('.count');
    let timer = null, pop = null;
    const close = () => {
      fb.classList.remove('open');
      input.blur();
      if (pop) { pop(); pop = null; }
      onClose && onClose();
    };
    fb.querySelector('[data-act=close]').onclick = close;
    fb.querySelector('[data-act=prev]').onclick = () => onPrev();
    fb.querySelector('[data-act=next]').onclick = () => onNext();
    input.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onSearch(input.value.trim()), 280);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(timer);
        if (input.dataset.last === input.value.trim()) onNext();
        else onSearch(input.value.trim());
        input.dataset.last = input.value.trim();
      }
    };
    fb.classList.add('open');
    pop = UI.pushOverlay(close);
    count.textContent = '';
    setTimeout(() => input.focus(), 50);
    if (input.value.trim()) onSearch(input.value.trim());
    return {
      count(cur, total) {
        count.textContent = total ? `${cur} z ${total}` : (input.value.trim() ? '0' : '');
      },
      close,
    };
  },
};

/**
 * Odczyt tekstu z rozpoznaniem kodowania: UTF-8/UTF-16 (z BOM lub bez),
 * a dla starszych polskich plików Windows-1250 albo ISO-8859-2.
 */
const ENCODINGS = [['utf-8', 'UTF-8'], ['windows-1250', 'Windows-1250 (polskie, Windows)'], ['iso-8859-2', 'ISO-8859-2 (Latin-2)'], ['utf-16le', 'UTF-16'], ['windows-1252', 'Windows-1252 (zachodnie)']];
function decodeText(buf, forced) {
  const b = new Uint8Array(buf);
  if (forced) {
    const skip = (forced === 'utf-8' && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) ? 3
      : (forced.startsWith('utf-16') && (b[0] === 0xff || b[0] === 0xfe)) ? 2 : 0;
    return { text: new TextDecoder(forced).decode(b.subarray(skip)), enc: forced };
  }
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(b.subarray(3)), enc: 'utf-8' };
  if (b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), enc: 'utf-16le' };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), enc: 'utf-16be' };
  // UTF-16 bez BOM: co drugi bajt zerowy
  let zeros = 0;
  const n = Math.min(b.length, 4000);
  for (let i = 1; i < n; i += 2) if (b[i] === 0) zeros++;
  if (n > 20 && zeros > n / 4) return { text: new TextDecoder('utf-16le').decode(b), enc: 'utf-16le' };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), enc: 'utf-8' }; } catch (e) { /* nie UTF-8 */ }
  let win = 0, iso = 0;
  for (const x of b) {
    if (x === 0xb9 || x === 0x9c || x === 0x9f || x === 0xa5 || x === 0x8c || x === 0x8f) win++;
    if (x === 0xb1 || x === 0xb6 || x === 0xbc || x === 0xa1 || x === 0xa6 || x === 0xac) iso++;
  }
  const enc = iso > win ? 'iso-8859-2' : 'windows-1250';
  return { text: new TextDecoder(enc).decode(b), enc };
}
function encodingLabel(enc) {
  const e = ENCODINGS.find(([k]) => k === enc);
  return e ? e[1].split(' ')[0] : enc.toUpperCase();
}
function chooseEncoding(current, onPick) {
  const list = h('div', { class: 'list' });
  let d;
  for (const [k, label] of ENCODINGS) {
    list.append(h('button', { text: (k === current ? '✓ ' : '') + label, onclick: () => { d.close(); onPick(k); } }));
  }
  d = UI.dialog({ title: 'Kodowanie znaków', body: list, buttons: [{ label: 'Anuluj' }] });
}

// linki „javascript:” z dokumentów nigdy nie są wykonywane
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (a && /^\s*javascript:/i.test(a.getAttribute('href'))) e.preventDefault();
}, true);

/** Obsługa przycisku Wstecz telefonu – wywoływana z części Android. */
window.handleBack = function () {
  const close = UI.overlays.pop();
  if (close) { close(); UI.syncBack(); return true; }
  if (window.onBackExtra && window.onBackExtra()) return true;
  return false;
};

/**
 * Szukanie w zwykłym dokumencie HTML (DOCX, ODT, tekst): podświetla wszystkie trafienia
 * i przewija do kolejnych.
 */
class DomSearch {
  constructor(root, scroller) {
    this.root = root;
    this.scroller = scroller;
    this.hits = [];
    this.cur = -1;
  }
  clear() {
    for (const m of this.root.querySelectorAll('mark.hit')) {
      const p = m.parentNode;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    }
    this.hits = [];
    this.cur = -1;
  }
  run(q) {
    this.clear();
    if (!q) return 0;
    const needle = foldText(q);
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentNode.closest('style,script') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    for (const node of nodes) {
      const hay = foldText(node.data);
      let from = 0, idx;
      const found = [];
      while ((idx = hay.indexOf(needle, from)) >= 0) { found.push(idx); from = idx + needle.length; }
      if (!found.length) continue;
      let rest = node;
      let consumed = 0;
      for (const i of found) {
        const start = rest.splitText(i - consumed);
        rest = start.splitText(needle.length);
        const mark = h('mark', { class: 'hit' });
        start.parentNode.replaceChild(mark, start);
        mark.append(start);
        this.hits.push(mark);
        consumed = i + needle.length;
      }
      if (this.hits.length > 5000) break;
    }
    if (this.hits.length) this.go(0);
    return this.hits.length;
  }
  go(i) {
    if (!this.hits.length) return;
    if (this.cur >= 0) this.hits[this.cur].classList.remove('cur');
    this.cur = (i + this.hits.length) % this.hits.length;
    const m = this.hits[this.cur];
    m.classList.add('cur');
    for (let d = m.closest('details:not([open])'); d; d = d.parentElement && d.parentElement.closest('details:not([open])')) d.open = true;
    m.scrollIntoView({ block: 'center', inline: 'center' });
  }
  next() { this.go(this.cur + 1); }
  prev() { this.go(this.cur - 1); }
}

/**
 * Powiększanie dwoma palcami (i podwójnym stuknięciem) dla zwykłej treści HTML.
 * W trakcie gestu treść jest tylko przeskalowana (płynnie), po puszczeniu palców
 * ustawiane jest prawdziwe powiększenie (CSS zoom), więc tekst jest ostry.
 */
class ZoomPane {
  constructor(scroller, content, { min = 0.25, max = 5, fit = () => 1, onChange } = {}) {
    this.s = scroller;
    this.c = content;
    this.min = min;
    this.max = max;
    this.fit = fit;
    this.onChange = onChange;
    this.zoom = 1;
    this.g = null;
    this.lastTap = null;
    content.classList.add('zoom-content');
    scroller.addEventListener('touchstart', (e) => this.start(e), { passive: false });
    scroller.addEventListener('touchmove', (e) => this.move(e), { passive: false });
    scroller.addEventListener('touchend', (e) => this.end(e));
    scroller.addEventListener('touchcancel', (e) => this.end(e));
    scroller.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = this.s.getBoundingClientRect();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
  }
  clamp(z) { return Math.min(this.max, Math.max(this.min, z)); }
  setZoom(z, fx, fy) {
    z = this.clamp(z);
    const old = this.zoom;
    if (fx == null) { fx = this.s.clientWidth / 2; fy = 0; }
    const lx = (this.s.scrollLeft + fx) / old;
    const ly = (this.s.scrollTop + fy) / old;
    this.zoom = z;
    this.c.style.zoom = z;
    this.s.scrollLeft = lx * z - fx;
    this.s.scrollTop = ly * z - fy;
    if (this.onChange) this.onChange(z);
  }
  start(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      const r = this.s.getBoundingClientRect();
      const fx = (a.clientX + b.clientX) / 2 - r.left;
      const fy = (a.clientY + b.clientY) / 2 - r.top;
      this.g = {
        d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
        fx, fy, mx: fx, my: fy, z0: this.zoom, ratio: 1,
        lx: (this.s.scrollLeft + fx) / this.zoom,
        ly: (this.s.scrollTop + fy) / this.zoom,
      };
      this.c.style.transformOrigin = `${this.g.lx}px ${this.g.ly}px`;
      this.c.style.willChange = 'transform';
      this.lastTap = null;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      this.tapStart = { x: t.clientX, y: t.clientY, t: Date.now() };
    }
  }
  move(e) {
    if (!this.g || e.touches.length !== 2) {
      if (this.tapStart && e.touches.length === 1) {
        const t = e.touches[0];
        if (Math.hypot(t.clientX - this.tapStart.x, t.clientY - this.tapStart.y) > 12) this.tapStart = null;
      }
      return;
    }
    e.preventDefault();
    const g = this.g;
    const [a, b] = e.touches;
    const r = this.s.getBoundingClientRect();
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
    g.ratio = this.clamp(g.z0 * d / g.d0) / g.z0;
    g.mx = (a.clientX + b.clientX) / 2 - r.left;
    g.my = (a.clientY + b.clientY) / 2 - r.top;
    this.c.style.transform = `translate(${(g.mx - g.fx) / g.z0}px, ${(g.my - g.fy) / g.z0}px) scale(${g.ratio})`;
  }
  end(e) {
    if (this.g) {
      if (e.touches.length >= 2) return;
      const g = this.g;
      this.g = null;
      this.c.style.transform = '';
      this.c.style.willChange = '';
      const z = this.clamp(g.z0 * g.ratio);
      this.zoom = z;
      this.c.style.zoom = z;
      this.s.scrollLeft = g.lx * z - g.mx;
      this.s.scrollTop = g.ly * z - g.my;
      if (this.onChange) this.onChange(z);
      this.tapStart = null;
      return;
    }
    // podwójne stuknięcie: przybliż / wróć do dopasowania
    if (this.tapStart && e.touches.length === 0 && Date.now() - this.tapStart.t < 250) {
      const now = Date.now();
      const tap = this.tapStart;
      if (this.lastTap && now - this.lastTap.t < 320 && Math.hypot(tap.x - this.lastTap.x, tap.y - this.lastTap.y) < 40) {
        const r = this.s.getBoundingClientRect();
        const fit = this.fit();
        this.setZoom(this.zoom > fit * 1.3 ? fit : fit * 2.2, tap.x - r.left, tap.y - r.top);
        this.lastTap = null;
      } else {
        this.lastTap = { x: tap.x, y: tap.y, t: now };
      }
    }
    this.tapStart = null;
  }
}

window.onChildFailed = () => UI.done();
