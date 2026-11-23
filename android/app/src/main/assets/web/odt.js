/*
 * Konwerter dokumentów OpenDocument (ODT) do HTML.
 * Obsługuje: style akapitów i tekstu (z dziedziczeniem), nagłówki, listy, tabele,
 * obrazy, ramki z tekstem, przypisy, linki, nagłówek/stopkę strony oraz podział na
 * strony według miejsc zapisanych przez LibreOffice (soft-page-break) i podziałów ręcznych.
 */
'use strict';

const OdtNS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  presentation: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
};

const odtIs = (n, ns, local) => n && n.nodeType === 1 && n.namespaceURI === OdtNS[ns] && n.localName === local;
const odtAttr = (n, ns, local) => (n && n.getAttributeNS ? n.getAttributeNS(OdtNS[ns], local) : null) || null;
const odtKids = (n) => Array.from(n.children || []);

/** Długość ODF (cm, mm, in, pt…) w punktach – potrzebne do proporcji obrazów. */
function odtLenPt(v) {
  const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|pc|px)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const f = { cm: 28.3465, mm: 2.83465, in: 72, pt: 1, pc: 12, px: 0.75 }[m[2] || 'pt'];
  return parseFloat(m[1]) * f;
}

/* ---------------- style ---------------- */
class OdtStyles {
  constructor() {
    this.styles = new Map();      // "family:name" -> {family, parent, props}
    this.defaults = {};           // family -> props
    this.fonts = {};              // nazwa -> {family, generic}
    this.lists = new Map();       // nazwa stylu listy -> {poziom: opis}
    this.pageLayouts = new Map();
    this.masterPages = new Map(); // nazwa -> {layout, header, footer}
    this.cache = new Map();
  }

  static props(styleEl) {
    const p = {};
    for (const k of odtKids(styleEl)) {
      // LibreOffice zapisuje część właściwości (np. wypełnienie komórek) w przestrzeni loext
      if (k.namespaceURI !== OdtNS.style && k.namespaceURI !== 'urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0') continue;
      const kind = k.localName.replace('-properties', '');   // text, paragraph, table-cell…
      const bag = p[kind] || (p[kind] = {});
      for (const a of Array.from(k.attributes)) bag[a.localName] = a.value;
      // obramowania/tła mogą być też w elementach potomnych – pomijamy (rzadkie)
    }
    return p;
  }

  addFonts(root) {
    if (!root) return;
    for (const f of odtKids(root)) {
      if (!odtIs(f, 'style', 'font-face')) continue;
      this.fonts[odtAttr(f, 'style', 'name')] = {
        family: (odtAttr(f, 'svg', 'font-family') || odtAttr(f, 'style', 'name') || '').replace(/^['"]|['"]$/g, ''),
        generic: odtAttr(f, 'style', 'font-family-generic'),
      };
    }
  }

  add(root, { onlyLayouts = false } = {}) {
    if (!root) return;
    for (const s of odtKids(root)) {
      if (odtIs(s, 'style', 'page-layout')) {
        this.pageLayouts.set(odtAttr(s, 'style', 'name'), OdtStyles.props(s)['page-layout'] || {});
      }
      if (onlyLayouts) continue;
      if (odtIs(s, 'style', 'style')) {
        const family = odtAttr(s, 'style', 'family');
        this.styles.set(family + ':' + odtAttr(s, 'style', 'name'), {
          family,
          parent: odtAttr(s, 'style', 'parent-style-name'),
          listStyle: odtAttr(s, 'style', 'list-style-name'),
          masterPage: odtAttr(s, 'style', 'master-page-name'),
          props: OdtStyles.props(s),
        });
      } else if (odtIs(s, 'style', 'default-style')) {
        this.defaults[odtAttr(s, 'style', 'family')] = OdtStyles.props(s);
      } else if (odtIs(s, 'text', 'list-style')) {
        const levels = {};
        for (const lv of odtKids(s)) {
          const level = Number(odtAttr(lv, 'text', 'level')) || 1;
          if (odtIs(lv, 'text', 'list-level-style-number')) {
            levels[level] = {
              type: 'number',
              format: odtAttr(lv, 'style', 'num-format') || '1',
              start: Number(odtAttr(lv, 'text', 'start-value')) || 1,
            };
          } else if (odtIs(lv, 'text', 'list-level-style-bullet')) {
            levels[level] = { type: 'bullet', char: odtAttr(lv, 'text', 'bullet-char') || '•' };
          } else {
            levels[level] = { type: 'bullet', char: '•' };
          }
        }
        this.lists.set(odtAttr(s, 'style', 'name'), levels);
      } else if (odtIs(s, 'style', 'master-page')) {
        this.masterPages.set(odtAttr(s, 'style', 'name'), {
          layout: odtAttr(s, 'style', 'page-layout-name'),
          header: odtKids(s).find((k) => odtIs(k, 'style', 'header')) || null,
          footer: odtKids(s).find((k) => odtIs(k, 'style', 'footer')) || null,
        });
      }
    }
  }

  /** Właściwości stylu po złożeniu z domyślnych i stylów nadrzędnych. */
  resolve(name, family) {
    const key = family + ':' + name;
    if (this.cache.has(key)) return this.cache.get(key);
    const chain = [];
    let cur = name, guard = 0;
    while (cur && guard++ < 30) {
      const s = this.styles.get(family + ':' + cur);
      if (!s) break;
      chain.unshift(s);
      cur = s.parent;
    }
    const out = {};
    const merge = (p) => {
      for (const [kind, bag] of Object.entries(p || {})) out[kind] = Object.assign(out[kind] || {}, bag);
    };
    merge(this.defaults[family]);
    for (const s of chain) merge(s.props);
    const s = this.styles.get(key);
    out.listStyle = chain.map((c) => c.listStyle).filter(Boolean).pop() || null;
    out.masterPage = s ? s.masterPage : null;
    this.cache.set(key, out);
    return out;
  }
}

/* ---------------- CSS z właściwości ODF ---------------- */
function odtFontStack(name, styles) {
  const f = styles.fonts[name] || { family: name };
  const fam = f.family || name;
  const l = fam.toLowerCase();
  let generic = { roman: 'serif', swiss: 'sans-serif', modern: 'monospace', script: 'cursive', decorative: 'fantasy' }[f.generic];
  if (!generic) {
    if (/mono|courier|consol/.test(l)) generic = 'monospace';
    else if (/serif|times|georgia|cambria|garamond|roman|book|palatino/.test(l) && !/sans/.test(l)) generic = 'serif';
    else generic = 'sans-serif';
  }
  return `"${fam.replace(/"/g, '')}", ${generic}`;
}

function odtTextCss(t, styles) {
  if (!t) return '';
  let c = '';
  if (t['font-size']) c += `font-size:${t['font-size']};`;
  if (t['font-weight']) c += `font-weight:${t['font-weight']};`;
  if (t['font-style']) c += `font-style:${t['font-style']};`;
  if (t['color']) c += `color:${t['color']};`;
  if (t['font-name']) c += `font-family:${odtFontStack(t['font-name'], styles)};`;
  else if (t['font-family']) c += `font-family:${odtFontStack(t['font-family'].replace(/'/g, ''), styles)};`;
  if (t['background-color'] && t['background-color'] !== 'transparent') c += `background-color:${t['background-color']};`;
  const deco = [];
  if (t['text-underline-style'] && t['text-underline-style'] !== 'none') deco.push('underline');
  if (t['text-line-through-style'] && t['text-line-through-style'] !== 'none') deco.push('line-through');
  if (deco.length) c += `text-decoration:${deco.join(' ')};`;
  else if (t['text-underline-style'] === 'none' || t['text-line-through-style'] === 'none') c += 'text-decoration:none;';
  if (t['text-transform']) c += `text-transform:${t['text-transform']};`;
  if (t['font-variant']) c += `font-variant:${t['font-variant']};`;
  if (t['letter-spacing'] && t['letter-spacing'] !== 'normal') c += `letter-spacing:${t['letter-spacing']};`;
  if (t['text-position']) {
    // „0% 100%” oznacza zwykły tekst – rozmiar zmieniamy tylko dla indeksów
    const [pos, size] = t['text-position'].split(/\s+/);
    const up = pos === 'super' || parseFloat(pos) > 0, down = pos === 'sub' || parseFloat(pos) < 0;
    if (up) c += 'vertical-align:super;';
    else if (down) c += 'vertical-align:sub;';
    if ((up || down) && size) c += `font-size:${size};`;
  }
  if (t['display'] === 'none') c += 'display:none;';
  return c;
}

const ODT_BOX = ['margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'border', 'border-top', 'border-bottom', 'border-left', 'border-right'];

function odtBoxCss(p) {
  let c = '';
  for (const k of ODT_BOX) if (p[k] && p[k] !== 'none') c += `${k}:${p[k]};`;
  if (p['background-color'] && p['background-color'] !== 'transparent') c += `background-color:${p['background-color']};`;
  return c;
}

function odtParaCss(p) {
  if (!p) return '';
  let c = odtBoxCss(p);
  const al = { start: 'left', end: 'right', left: 'left', right: 'right', center: 'center', justify: 'justify' }[p['text-align']];
  if (al) c += `text-align:${al};`;
  if (p['text-indent']) c += `text-indent:${p['text-indent']};`;
  if (p['line-height'] && p['line-height'] !== 'normal') {
    const lh = p['line-height'];
    c += `line-height:${lh.endsWith('%') ? parseFloat(lh) / 100 * 1.17 : lh};`;
  } else if (p['line-height-at-least']) {
    c += `line-height:max(1.17em, ${p['line-height-at-least']});`;
  }
  return c;
}

/* ---------------- konwersja treści ---------------- */
class OdtConverter {
  constructor(styles, zip, prefix) {
    this.st = styles;
    this.zip = zip;
    this.prefix = prefix;
    this.classes = new Map();
    this.css = [];
    this.notes = [];
    this.images = [];   // obietnice wczytania obrazów
    this.n = 0;
  }

  cls(name, family, kind) {
    if (!name) return null;
    const key = family + ':' + name + ':' + kind;
    if (this.classes.has(key)) return this.classes.get(key);
    const r = this.st.resolve(name, family);
    let css = '';
    if (kind === 'p') css = odtParaCss(r.paragraph) + odtTextCss(r.text, this.st);
    else if (kind === 'span') css = odtTextCss(r.text, this.st);
    else if (kind === 'cell') {
      const c = r['table-cell'] || {};
      css = odtBoxCss(c);
      const va = { top: 'top', middle: 'middle', bottom: 'bottom' }[c['vertical-align']];
      if (va) css += `vertical-align:${va};`;
      // komórki tabel w prezentacjach mają wypełnienie we właściwościach graficznych
      const g = r.graphic || {};
      if (g.fill === 'solid' && g['fill-color']) css += `background-color:${g['fill-color']};`;
      for (const k of ['padding-top', 'padding-bottom', 'padding-left', 'padding-right']) if (g[k] && !c[k] && !c.padding) css += `${k}:${g[k]};`;
      if (g['textarea-vertical-align'] && !va) css += `vertical-align:${g['textarea-vertical-align']};`;
      css += odtTextCss(r.text, this.st) + odtParaCss(r.paragraph);
    } else if (kind === 'table') {
      const t = r.table || {};
      if (t.width) css += `width:${t.width};`;
      if (t['rel-width']) css += `width:${t['rel-width']};`;
      const al = t.align;
      if (al === 'center') css += 'margin-left:auto;margin-right:auto;';
      else if (al === 'right') css += 'margin-left:auto;';
      else if (t['margin-left']) css += `margin-left:${t['margin-left']};`;
      if (t['margin-top']) css += `margin-top:${t['margin-top']};`;
      if (t['margin-bottom']) css += `margin-bottom:${t['margin-bottom']};`;
      if (t['background-color'] && t['background-color'] !== 'transparent') css += `background-color:${t['background-color']};`;
    } else if (kind === 'row') {
      const t = r['table-row'] || {};
      if (t['min-row-height']) css += `height:${t['min-row-height']};`;
      else if (t['row-height']) css += `height:${t['row-height']};`;
      if (t['background-color'] && t['background-color'] !== 'transparent') css += `background-color:${t['background-color']};`;
    }
    if (!css) { this.classes.set(key, null); return null; }
    const c = `${this.prefix}${++this.n}`;
    this.css.push(`.${c}{${css}}`);
    this.classes.set(key, c);
    return c;
  }

  colWidth(name) {
    if (!name) return null;
    const r = this.st.resolve(name, 'table-column');
    const c = r['table-column'] || {};
    return c['column-width'] || null;
  }

  /* --- bloki --- */
  blocks(parent, out, ctx = {}) {
    for (const n of odtKids(parent)) this.block(n, out, ctx);
  }

  block(n, out, ctx) {
    if (odtIs(n, 'text', 'p') || odtIs(n, 'text', 'h')) return this.para(n, out, ctx);
    if (odtIs(n, 'text', 'list')) return this.list(n, out, ctx);
    if (odtIs(n, 'table', 'table')) return this.table(n, out);
    if (odtIs(n, 'text', 'section')) {
      const d = h('div', { class: 'odt-section' });
      this.blocks(n, d, ctx);
      return out.append(d);
    }
    if (odtIs(n, 'text', 'soft-page-break')) return;
    if (n.namespaceURI === OdtNS.text && /(table-of-content|index|bibliography)$/.test(n.localName)) {
      const body = odtKids(n).find((k) => odtIs(k, 'text', 'index-body'));
      if (body) {
        const d = h('div', { class: 'odt-index' });
        this.blocks(body, d, ctx);
        out.append(d);
      }
      return;
    }
    if (odtIs(n, 'text', 'index-title')) return this.blocks(n, out, ctx);
    if (odtIs(n, 'draw', 'frame') || odtIs(n, 'draw', 'a')) {
      const holder = h('div');
      this.inline(n, holder, ctx);
      return out.append(...holder.childNodes);
    }
    // pozostałe (deklaracje zmiennych, formularze, śledzenie zmian) pomijamy
  }

  para(n, out, ctx) {
    const isH = odtIs(n, 'text', 'h');
    const style = odtAttr(n, 'text', 'style-name');
    let tag = 'p';
    if (isH) tag = 'h' + Math.min(6, Math.max(1, Number(odtAttr(n, 'text', 'outline-level')) || 1));
    const el = h(tag, { class: this.cls(style, 'paragraph', 'p') });
    this.inlines(n, el, ctx);
    if (!el.childNodes.length) el.append(h('br'));
    out.append(el);
  }

  list(n, out, ctx, level = 1, inherited = null) {
    const styleName = odtAttr(n, 'text', 'style-name') || inherited || ctx.listStyle || null;
    const levels = (styleName && this.st.lists.get(styleName)) || {};
    const lv = levels[level] || { type: 'bullet', char: '•' };
    let el;
    if (lv.type === 'number') {
      el = h('ol', { class: 'odt-list' });
      el.style.listStyleType = { 1: 'decimal', a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' }[lv.format] || 'decimal';
      if (lv.format === '') el.style.listStyleType = 'none';
      if (lv.start && lv.start !== 1) el.start = lv.start;
    } else {
      el = h('ul', { class: 'odt-list' });
      let ch = lv.char || '•';
      if (/[-]/.test(ch)) ch = '•';           // znaki z czcionek symboli
      el.style.listStyleType = `"${ch.replace(/"/g, '')}  "`;
    }
    for (const it of odtKids(n)) {
      const header = odtIs(it, 'text', 'list-header');
      if (!odtIs(it, 'text', 'list-item') && !header) continue;
      const li = h('li');
      // element zawierający tylko podlistę nie ma własnego punktora
      const onlyNested = odtKids(it).every((k) => odtIs(k, 'text', 'list') || odtIs(k, 'text', 'soft-page-break'));
      if (header || onlyNested) li.style.listStyleType = 'none';
      const sv = odtAttr(it, 'text', 'start-value');
      if (sv && lv.type === 'number') li.value = Number(sv);
      for (const k of odtKids(it)) {
        if (odtIs(k, 'text', 'list')) this.list(k, li, ctx, level + 1, styleName);
        else if (odtIs(k, 'text', 'number')) continue;
        else this.block(k, li, ctx);
      }
      el.append(li);
    }
    out.append(el);
  }

  table(n, out) {
    const t = h('table', { class: ['odt-table', this.cls(odtAttr(n, 'table', 'style-name'), 'table', 'table')].filter(Boolean).join(' ') });
    const cols = [];
    const collectCols = (p) => {
      for (const k of odtKids(p)) {
        if (odtIs(k, 'table', 'table-column')) {
          const rep = Math.min(512, Number(odtAttr(k, 'table', 'number-columns-repeated')) || 1);
          const w = this.colWidth(odtAttr(k, 'table', 'style-name'));
          for (let i = 0; i < rep; i++) cols.push(w);
        } else if (/^table-(columns|column-group|header-columns)$/.test(k.localName) && k.namespaceURI === OdtNS.table) collectCols(k);
      }
    };
    collectCols(n);
    if (cols.some(Boolean)) {
      const cg = h('colgroup');
      for (const w of cols) cg.append(h('col', w ? { style: `width:${w}` } : null));
      t.append(cg);
    }
    const body = h('tbody');
    const rows = (p, into) => {
      for (const k of odtKids(p)) {
        if (odtIs(k, 'table', 'table-row')) {
          const rep = Math.min(200, Number(odtAttr(k, 'table', 'number-rows-repeated')) || 1);
          for (let i = 0; i < rep; i++) into.append(this.row(k));
        } else if (odtIs(k, 'table', 'table-header-rows')) {
          const th = h('thead');
          rows(k, th);
          t.append(th);
        } else if (k.namespaceURI === OdtNS.table && /^table-(rows|row-group)$/.test(k.localName)) {
          rows(k, into);
        } else if (odtIs(k, 'text', 'soft-page-break')) {
          /* podział strony w środku tabeli – ignorujemy */
        }
      }
    };
    rows(n, body);
    t.append(body);
    const wrap = h('div', { class: 'odt-table-wrap' }, t);
    out.append(wrap);
  }

  row(r) {
    const tr = h('tr', { class: this.cls(odtAttr(r, 'table', 'style-name'), 'table-row', 'row') });
    const rowDefault = odtAttr(r, 'table', 'default-cell-style-name');
    for (const c of odtKids(r)) {
      if (!odtIs(c, 'table', 'table-cell')) continue;
      const rep = Math.min(64, Number(odtAttr(c, 'table', 'number-columns-repeated')) || 1);
      for (let i = 0; i < rep; i++) {
        const td = h('td', { class: this.cls(odtAttr(c, 'table', 'style-name') || rowDefault, 'table-cell', 'cell') });
        const cs = Number(odtAttr(c, 'table', 'number-columns-spanned')) || 1;
        const rs = Number(odtAttr(c, 'table', 'number-rows-spanned')) || 1;
        if (cs > 1) td.colSpan = cs;
        if (rs > 1) td.rowSpan = rs;
        this.blocks(c, td, {});
        tr.append(td);
      }
    }
    return tr;
  }

  /* --- treść akapitu --- */
  inlines(parent, out, ctx) {
    for (const n of Array.from(parent.childNodes)) this.inline(n, out, ctx);
  }

  inline(n, out, ctx) {
    if (n.nodeType === 3) { out.append(n.data.replace(/[\r\n]+/g, ' ')); return; }
    if (n.nodeType !== 1) return;
    const ns = n.namespaceURI, l = n.localName;
    if (ns === OdtNS.text) {
      switch (l) {
        case 'span': {
          const s = h('span', { class: this.cls(odtAttr(n, 'text', 'style-name'), 'text', 'span') });
          this.inlines(n, s, ctx);
          out.append(s);
          return;
        }
        case 'a': {
          const href = odtAttr(n, 'xlink', 'href') || '';
          const a = h('a', { href: /^(https?:|mailto:|#)/i.test(href) ? href : null, target: href.startsWith('#') ? null : '_blank' });
          this.inlines(n, a, ctx);
          out.append(a);
          return;
        }
        case 's': out.append(' '.repeat(Math.min(200, Number(odtAttr(n, 'text', 'c')) || 1))); return;
        case 'tab': out.append(h('span', { class: 'odt-tab', text: '\t' })); return;
        case 'line-break': out.append(h('br')); return;
        case 'soft-page-break': return;
        case 'note': return this.note(n, out);
        case 'page-number': out.append(h('span', { class: 'odt-pgnum', text: n.textContent })); return;
        case 'page-count': out.append(h('span', { class: 'odt-pgcount', text: n.textContent })); return;
        case 'number': out.append(n.textContent + ' '); return;
        case 'bookmark': case 'bookmark-start': {
          const id = odtAttr(n, 'text', 'name');
          if (id) out.append(h('a', { id }));
          return;
        }
        case 'bookmark-end': case 'reference-mark': case 'reference-mark-start': case 'reference-mark-end':
        case 'change': case 'change-start': case 'change-end': case 'alphabetical-index-mark': case 'toc-mark':
          return;
        case 'ruby': {
          const base = odtKids(n).find((k) => odtIs(k, 'text', 'ruby-base'));
          if (base) this.inlines(base, out, ctx);
          return;
        }
        default:
          this.inlines(n, out, ctx);   // pola (data, autor, odsyłacze…) – pokazujemy zapisany tekst
          return;
      }
    }
    if (ns === OdtNS.office && (l === 'annotation' || l === 'annotation-end')) return;
    if (ns === OdtNS.draw) {
      if (l === 'frame') return this.frame(n, out, ctx);
      if (l === 'a') {
        const href = odtAttr(n, 'xlink', 'href') || '';
        const a = h('a', { href: /^https?:/i.test(href) ? href : null, target: '_blank' });
        this.inlines(n, a, ctx);
        out.append(a);
        return;
      }
      return; // kształty rysunkowe pomijamy
    }
    this.inlines(n, out, ctx);
  }

  note(n, out) {
    const cit = odtKids(n).find((k) => odtIs(k, 'text', 'note-citation'));
    const body = odtKids(n).find((k) => odtIs(k, 'text', 'note-body'));
    const label = (cit && cit.textContent) || String(this.notes.length + 1);
    const id = `${this.prefix}fn${this.notes.length + 1}`;
    out.append(h('sup', { class: 'odt-fnref' }, h('a', { href: '#' + id, text: label })));
    const d = h('div', { class: 'odt-fn', id }, h('span', { class: 'odt-fnlabel', text: label + ' ' }));
    if (body) this.blocks(body, d, {});
    this.notes.push(d);
  }

  frame(n, out, ctx) {
    const anchor = odtAttr(n, 'text', 'anchor-type') || 'paragraph';
    const w = odtAttr(n, 'svg', 'width');
    const hh = odtAttr(n, 'svg', 'height');
    const g = (this.st.resolve(odtAttr(n, 'draw', 'style-name'), 'graphic').graphic) || {};
    const box = h('span', { class: 'odt-frame' });
    if (anchor === 'as-char' || anchor === 'char') box.style.display = 'inline-block';
    else {
      const hp = g['horizontal-pos'];
      const wrap = g.wrap;
      if (wrap === 'left' || wrap === 'right' || wrap === 'parallel' || wrap === 'dynamic') {
        box.style.cssFloat = hp === 'right' || hp === 'outside' ? 'right' : 'left';
        box.style.margin = '0 0.3cm 0.2cm 0';
      } else {
        box.style.display = 'block';
        if (hp === 'center') box.style.margin = '0 auto';
        else if (hp === 'right') box.style.marginLeft = 'auto';
      }
    }
    if (w) box.style.width = w;
    const images = odtKids(n).filter((k) => odtIs(k, 'draw', 'image'));
    const textBox = odtKids(n).find((k) => odtIs(k, 'draw', 'text-box'));
    if (images.length) {
      const img = h('img', { alt: odtKids(n).find((k) => odtIs(k, 'svg', 'title'))?.textContent || '' });
      if (w) img.style.width = '100%';
      const wp = odtLenPt(w), hp = odtLenPt(hh);
      if (wp && hp) img.style.aspectRatio = `${wp} / ${hp}`;
      box.append(img);
      this.images.push(this.loadImage(images, img, box));
    } else if (textBox) {
      box.classList.add('odt-textbox');
      if (!w) box.style.display = 'block';
      this.blocks(textBox, box, ctx);
    }
    out.append(box);
  }

  async loadImage(images, img, box) {
    const ok = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
    let chosen = images.map((i) => odtAttr(i, 'xlink', 'href')).find((p) => p && ok.test(p))
      || images.map((i) => odtAttr(i, 'xlink', 'href')).find(Boolean);
    if (!chosen) return;
    const path = chosen.replace(/^\.\//, '');
    const f = this.zip.file(path);
    if (!f) { img.replaceWith(h('span', { class: 'odt-noimg', text: 'obraz niedostępny' })); return; }
    const bytes = await f.async('uint8array');
    let type = 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) type = 'image/jpeg';
    else if (bytes[0] === 0x47 && bytes[1] === 0x49) type = 'image/gif';
    else if (bytes[0] === 0x52 && bytes[8] === 0x57) type = 'image/webp';
    else if (bytes[0] === 0x42 && bytes[1] === 0x4d) type = 'image/bmp';
    else if (bytes[0] === 0x89 && bytes[1] === 0x50) type = 'image/png';
    else if (/\.svg$/i.test(path) || new TextDecoder().decode(bytes.slice(0, 200)).includes('<svg')) type = 'image/svg+xml';
    else {
      // WMF/EMF/SVM – przeglądarka ich nie wyświetli
      img.replaceWith(h('span', { class: 'odt-noimg', text: 'obraz w formacie ' + (path.split('.').pop() || '?').toUpperCase() }));
      return;
    }
    img.src = URL.createObjectURL(new Blob([bytes], { type }));
    box.dataset.loaded = '1';
  }
}

/* ---------------- składanie dokumentu ---------------- */
const OdtView = {
  BASE_CSS: `
.odt-wrapper { font-size: 12pt; }
.odt-page { position: relative; box-sizing: border-box; line-height: 1.17; overflow-wrap: break-word; }
:where(.odt-page) :where(p,h1,h2,h3,h4,h5,h6) { margin: 0; font-size: inherit; font-weight: inherit; min-height: 1.17em; }
:where(.odt-page) .odt-tab { white-space: pre; tab-size: 4; }
:where(.odt-page) :where(ul.odt-list, ol.odt-list) { margin: 0; padding-left: 1.2cm; }
:where(.odt-page) .odt-table-wrap { overflow-x: auto; max-width: 100%; }
:where(.odt-page) :where(table.odt-table) { border-collapse: collapse; table-layout: auto; }
:where(.odt-page) :where(table.odt-table td) { padding: 0.1cm; vertical-align: top; }
.odt-page .odt-frame img { display: block; max-width: 100%; height: auto; }
.odt-page .odt-noimg { display: inline-block; padding: 12px; background: #f1f3f6; color: #667; font: 12px sans-serif; border: 1px dashed #bbb; }
.odt-page .odt-fns { margin-top: 1.2em; padding-top: .4em; border-top: 1px solid #999; font-size: 0.85em; }
.odt-page .odt-fnref a { text-decoration: none; }
.odt-page .odt-header { margin-bottom: 0.5cm; }
.odt-page .odt-footer { margin-top: 0.5cm; }
.odt-page .odt-section { display: block; }
#doc.reading .odt-header, #doc.reading .odt-footer { display: none; }
`,

  async render(data, el, mode) {
    const zip = await JSZip.loadAsync(data);
    const manifest = zip.file('META-INF/manifest.xml');
    if (manifest && /encryption-data/.test(await manifest.async('string'))) throw new Error('Plik zaszyfrowany hasłem');
    const parse = async (name) => {
      const f = zip.file(name);
      if (!f) return null;
      const doc = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) throw new Error('Uszkodzony plik ' + name);
      return doc;
    };
    const content = await parse('content.xml');
    if (!content) throw new Error('Brak treści dokumentu (content.xml)');
    const stylesDoc = await parse('styles.xml');
    const child = (doc, local) => doc && odtKids(doc.documentElement).find((k) => odtIs(k, 'office', local));

    // style treści: wspólne ze styles.xml + automatyczne z content.xml
    const st = new OdtStyles();
    st.addFonts(child(stylesDoc, 'font-face-decls'));
    st.addFonts(child(content, 'font-face-decls'));
    st.add(child(stylesDoc, 'styles'));
    st.add(child(stylesDoc, 'automatic-styles'), { onlyLayouts: true });
    st.add(child(stylesDoc, 'master-styles'));
    st.add(child(content, 'automatic-styles'));

    // style nagłówka/stopki: wspólne + automatyczne ze styles.xml (inne nazwy niż w treści)
    const stM = new OdtStyles();
    stM.fonts = st.fonts;
    stM.add(child(stylesDoc, 'styles'));
    stM.add(child(stylesDoc, 'automatic-styles'));

    const body = child(content, 'body');
    const text = body && odtKids(body).find((k) => odtIs(k, 'office', 'text'));
    if (!text) throw new Error('To nie jest dokument tekstowy ODT');

    const conv = new OdtConverter(st, zip, 'c');
    const convM = new OdtConverter(stM, zip, 'm');

    // układ strony
    let master = st.masterPages.get('Standard') || st.masterPages.values().next().value || null;
    const pageCss = (m) => {
      const lay = (m && st.pageLayouts.get(m.layout)) || {};
      const pw = lay['page-width'] || '21cm', ph = lay['page-height'] || '29.7cm';
      const mg = (k) => lay['margin-' + k] || lay.margin || '2cm';
      return `width:${pw};min-height:${ph};padding:${mg('top')} ${mg('right')} ${mg('bottom')} ${mg('left')};`;
    };

    const wrapper = h('div', { class: 'odt-wrapper' });
    const pages = [];
    let page = null, flow = null;
    const newPage = (m) => {
      if (m) master = m;
      page = h('section', { class: 'odt-page', style: mode === 'read' ? '' : pageCss(master) });
      page.master = master;
      if (mode !== 'read' && master && master.header) {
        const hd = h('div', { class: 'odt-header' });
        convM.blocks(master.header, hd);
        page.append(hd);
      }
      flow = h('div', { class: 'odt-flow' });
      page.append(flow);
      pages.push(page);
      wrapper.append(page);
    };
    newPage(null);

    // podział na strony: miejsca zapisane przez LibreOffice (soft-page-break)
    // i ręczne podziały / zmiany stylu strony w akapitach i tabelach
    let pendingBreak = false;
    for (const n of odtKids(text)) {
      if (mode !== 'read') {
        if (odtIs(n, 'text', 'soft-page-break')) { pendingBreak = true; continue; }
        let brk = false, mp = null;
        const isPara = odtIs(n, 'text', 'p') || odtIs(n, 'text', 'h');
        const isTable = odtIs(n, 'table', 'table');
        if (isPara || isTable) {
          const r = st.resolve(odtAttr(n, isPara ? 'text' : 'table', 'style-name'), isPara ? 'paragraph' : 'table');
          const props = isPara ? r.paragraph : r.table;
          brk = !!(props && props['break-before'] === 'page');
          mp = r.masterPage ? st.masterPages.get(r.masterPage) || null : null;
          if (isPara) {
            const first = n.firstChild;
            if (first && odtIs(first, 'text', 'soft-page-break')) brk = true;
          }
        }
        if ((pendingBreak || brk || (mp && mp !== master)) && flow.childNodes.length) {
          newPage(mp);
        } else if (mp && mp !== master) {
          master = mp;
          page.master = mp;
          page.setAttribute('style', pageCss(mp));
        }
        pendingBreak = false;
      }
      conv.block(n, flow, {});
    }

    if (conv.notes.length) {
      const fns = h('div', { class: 'odt-fns' }, ...conv.notes);
      pages[pages.length - 1].append(fns);
    }
    if (mode !== 'read' && master) {
      for (const p of pages) {
        const m = p.master || master;
        if (m && m.footer) {
          const ft = h('div', { class: 'odt-footer' });
          convM.blocks(m.footer, ft);
          p.append(ft);
        }
      }
    }
    pages.forEach((p, i) => {
      for (const s of p.querySelectorAll('.odt-pgnum')) s.textContent = String(i + 1);
      for (const s of p.querySelectorAll('.odt-pgcount')) s.textContent = String(pages.length);
    });

    // domyślna czcionka dokumentu
    const def = st.defaults.paragraph && st.defaults.paragraph.text;
    const baseCss = def ? odtTextCss(def, st) : '';
    const style = h('style', { text: OdtView.BASE_CSS + `.odt-wrapper{${baseCss}}` + conv.css.join('') + convM.css.join('') });
    el.append(style, wrapper);
    await Promise.all([...conv.images, ...convM.images].map((p) => p.catch(() => {})));
    return pages.length;
  },
};
