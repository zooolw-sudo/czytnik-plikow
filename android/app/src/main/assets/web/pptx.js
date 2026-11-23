/*
 * Renderer prezentacji PowerPoint (PPTX): rozmiar slajdu, motyw (kolory, czcionki),
 * wzorzec i układ (tła, kształty, pozycje i style pól zastępczych), kształty z wypełnieniem
 * i obramowaniem, tekst z dziedziczeniem stylów (rozmiary, punktory, wyrównanie),
 * obrazy z kadrowaniem, grupy, linie, tabele, notatki prelegenta.
 * Wykresy i SmartArt pokazywane jako zastępczy prostokąt z opisem.
 */
'use strict';

const Pptx = (() => {
  const NS = {
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  };
  const EMU = 9525; // EMU na piksel (96 dpi)
  const kid = (el, name) => (el ? Array.from(el.children).find((c) => c.localName === name) || null : null);
  const kids = (el, name) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
  const path = (el, ...names) => { for (const n of names) { el = kid(el, n); if (!el) return null; } return el; };
  const rid = (el, name = 'embed') => el && (el.getAttributeNS(NS.r, name) || el.getAttribute('r:' + name));
  const num = (v, d = 0) => (v == null || v === '' ? d : Number(v));

  let zip, theme, presDefaults;

  async function xml(p) {
    const f = zip.file(p);
    if (!f) return null;
    return new DOMParser().parseFromString(await f.async('string'), 'application/xml');
  }
  function resolve(base, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/').slice(0, -1).concat(target.split('/'));
    const out = [];
    for (const x of parts) { if (x === '..') out.pop(); else if (x !== '.') out.push(x); }
    return out.join('/');
  }
  async function rels(p) {
    const relPath = p.replace(/[^/]+$/, (f) => '_rels/' + f + '.rels');
    const d = await xml(relPath);
    const map = new Map();
    if (d) for (const r of Array.from(d.documentElement.children)) {
      map.set(r.getAttribute('Id'), { type: (r.getAttribute('Type') || '').split('/').pop(), target: r.getAttribute('TargetMode') === 'External' ? null : resolve(p, r.getAttribute('Target')) });
    }
    return map;
  }
  const relByType = (map, type) => [...map.values()].find((r) => r.type === type);

  const blobCache = new Map();
  async function blob(p) {
    if (!p) return null;
    if (blobCache.has(p)) return blobCache.get(p);
    const f = zip.file(p);
    if (!f) return null;
    const u8 = await f.async('uint8array');
    let type = '';
    if (u8[0] === 0x89) type = 'image/png'; else if (u8[0] === 0xff) type = 'image/jpeg'; else if (u8[0] === 0x47) type = 'image/gif';
    else if (/\.svg$/i.test(p)) type = 'image/svg+xml'; else if (/\.(emf|wmf)$/i.test(p)) type = 'x-metafile';
    const url = type === 'x-metafile' ? null : URL.createObjectURL(new Blob([u8], { type }));
    blobCache.set(p, url);
    return url;
  }

  /* ---------------- kolory ---------------- */
  const PRESET = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500' };
  function hexToRgb(h) { return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let hh = 0, s = 0;
    const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hh /= 6;
    }
    return [hh, s, l];
  }
  function hslToRgb([hh, s, l]) {
    if (!s) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255];
  }

  /** Kolor z elementu (srgbClr, schemeClr…) z modyfikatorami; ctx.map – mapa kolorów wzorca. */
  function color(el, ctx, phClr) {
    if (!el) return null;
    const c = Array.from(el.children).find((x) => /Clr$/.test(x.localName));
    if (!c) return null;
    let hex = null;
    switch (c.localName) {
      case 'srgbClr': hex = c.getAttribute('val'); break;
      case 'sysClr': hex = c.getAttribute('lastClr') || (c.getAttribute('val') === 'window' ? 'FFFFFF' : '000000'); break;
      case 'prstClr': hex = PRESET[c.getAttribute('val')] || '000000'; break;
      case 'scrgbClr': hex = [c.getAttribute('r'), c.getAttribute('g'), c.getAttribute('b')].map((v) => Math.round(num(v) / 100000 * 255).toString(16).padStart(2, '0')).join(''); break;
      case 'schemeClr': {
        let v = c.getAttribute('val');
        if (v === 'phClr') { if (phClr) return applyMods(phClr, c); v = 'tx1'; }
        const mapped = (ctx && ctx.map && ctx.map[v]) || { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }[v] || v;
        hex = theme.colors[mapped] || '000000';
        break;
      }
      default: return null;
    }
    return applyMods(hex, c);
  }
  function applyMods(hex, c) {
    let rgb = typeof hex === 'string' ? hexToRgb(hex) : hex.rgb;
    let alpha = typeof hex === 'string' ? 1 : hex.a;
    for (const m of Array.from(c.children)) {
      const v = num(m.getAttribute('val')) / 100000;
      switch (m.localName) {
        case 'lumMod': { const h = rgbToHsl(rgb); h[2] *= v; rgb = hslToRgb(h); break; }
        case 'lumOff': { const h = rgbToHsl(rgb); h[2] = Math.min(1, h[2] + v); rgb = hslToRgb(h); break; }
        case 'satMod': { const h = rgbToHsl(rgb); h[1] = Math.min(1, h[1] * v); rgb = hslToRgb(h); break; }
        case 'tint': rgb = rgb.map((x) => x + (255 - x) * (1 - v)); break;
        case 'shade': rgb = rgb.map((x) => x * v); break;
        case 'alpha': alpha = v; break;
        default: break;
      }
    }
    return { rgb: rgb.map((x) => Math.max(0, Math.min(255, Math.round(x)))), a: alpha };
  }
  const css = (c) => (c ? (c.a < 1 ? `rgba(${c.rgb.join(',')},${c.a.toFixed(3)})` : `rgb(${c.rgb.join(',')})`) : null);

  async function fillCss(spPr, ctx, styleEl, phClr) {
    if (!spPr && !styleEl) return null;
    if (kid(spPr, 'noFill')) return 'transparent';
    const sf = kid(spPr, 'solidFill');
    if (sf) return css(color(sf, ctx, phClr));
    const gf = kid(spPr, 'gradFill');
    if (gf) {
      const stops = kids(kid(gf, 'gsLst'), 'gs').map((g) => `${css(color(g, ctx, phClr))} ${num(g.getAttribute('pos')) / 1000}%`);
      const ang = num(path(gf, 'lin') && path(gf, 'lin').getAttribute('ang')) / 60000;
      return stops.length ? `linear-gradient(${90 + ang}deg, ${stops.join(',')})` : null;
    }
    const bf = kid(spPr, 'blipFill');
    if (bf) {
      const url = await blob(ctx.rels.get(rid(kid(bf, 'blip')))?.target);
      return url ? `center / cover no-repeat url("${url}")` : null;
    }
    if (styleEl) {
      const fr = kid(styleEl, 'fillRef');
      if (fr && num(fr.getAttribute('idx')) > 0) return css(color(fr, ctx));
    }
    return null;
  }

  function lineCss(spPr, ctx, styleEl) {
    const ln = kid(spPr, 'ln');
    if (ln && kid(ln, 'noFill')) return null;
    let c = ln && kid(ln, 'solidFill') ? color(kid(ln, 'solidFill'), ctx) : null;
    if (!c && styleEl) { const lr = kid(styleEl, 'lnRef'); if (lr && num(lr.getAttribute('idx')) > 0) c = color(lr, ctx); }
    if (!c) return null;
    const w = Math.max(1, num(ln && ln.getAttribute('w'), 9525) / EMU);
    const dash = ln && kid(ln, 'prstDash') && kid(ln, 'prstDash').getAttribute('val');
    return { w, color: css(c), style: dash && dash !== 'solid' ? 'dashed' : 'solid' };
  }

  /* ---------------- tekst i dziedziczenie stylów ---------------- */
  function lvlProps(lstStyle, lvl) {
    const l = kid(lstStyle, `lvl${lvl + 1}pPr`);
    return l;
  }

  /** Lista elementów pPr od najogólniejszego do najbardziej szczegółowego. */
  function chainFor(ctx, ph, shapeLst, lvl) {
    const chain = [];
    const def = lvlProps(presDefaults, lvl);
    if (def) chain.push(def);
    const ms = ctx.masterTxStyles;
    const type = ph ? (ph.getAttribute('type') || 'body') : null;
    const kind = !ph ? 'otherStyle' : (type === 'title' || type === 'ctrTitle') ? 'titleStyle' : (/^(body|subTitle|obj)$/.test(type) || !ph.getAttribute('type')) ? 'bodyStyle' : 'otherStyle';
    const msl = ms && lvlProps(kid(ms, kind), lvl);
    if (msl) chain.push(msl);
    if (ph) {
      for (const holder of [ctx.masterPh, ctx.layoutPh]) {
        const sp = holder && holder(ph);
        const ls = sp && path(sp, 'txBody', 'lstStyle');
        const l = ls && lvlProps(ls, lvl);
        if (l) chain.push(l);
      }
    }
    const own = shapeLst && lvlProps(shapeLst, lvl);
    if (own) chain.push(own);
    return chain;
  }

  function mergeRun(chain, pPr, rPr) {
    const out = { sz: 1800, b: false, i: false, u: false, strike: false, color: null, font: null, baseline: 0 };
    const apply = (r) => {
      if (!r) return;
      if (r.getAttribute('sz')) out.sz = num(r.getAttribute('sz'));
      if (r.getAttribute('b') != null) out.b = r.getAttribute('b') === '1' || r.getAttribute('b') === 'true';
      if (r.getAttribute('i') != null) out.i = r.getAttribute('i') === '1' || r.getAttribute('i') === 'true';
      if (r.getAttribute('u')) out.u = r.getAttribute('u') !== 'none';
      if (r.getAttribute('strike')) out.strike = r.getAttribute('strike') !== 'noStrike';
      if (r.getAttribute('baseline')) out.baseline = num(r.getAttribute('baseline'));
      if (kid(r, 'solidFill')) out.colorEl = kid(r, 'solidFill');
      const lat = kid(r, 'latin');
      if (lat && lat.getAttribute('typeface')) out.font = lat.getAttribute('typeface');
    };
    for (const p of chain) apply(kid(p, 'defRPr'));
    if (pPr) apply(kid(pPr, 'defRPr'));
    apply(rPr);
    return out;
  }

  function mergePara(chain, pPr) {
    const out = { algn: 'l', marL: 0, indent: 0, bu: null, buFont: null, buColor: null, auto: null, lnSpc: null, spcBef: 0, spcAft: 0, buNone: false };
    const apply = (p) => {
      if (!p) return;
      if (p.getAttribute('algn')) out.algn = p.getAttribute('algn');
      if (p.getAttribute('marL') != null) out.marL = num(p.getAttribute('marL'));
      if (p.getAttribute('indent') != null) out.indent = num(p.getAttribute('indent'));
      if (kid(p, 'buNone')) { out.buNone = true; out.bu = null; out.auto = null; }
      if (kid(p, 'buChar')) { out.bu = kid(p, 'buChar').getAttribute('char'); out.auto = null; out.buNone = false; }
      if (kid(p, 'buAutoNum')) { out.auto = kid(p, 'buAutoNum').getAttribute('type'); out.bu = null; out.buNone = false; }
      if (kid(p, 'buFont')) out.buFont = kid(p, 'buFont').getAttribute('typeface');
      if (kid(p, 'buClr')) out.buColor = kid(p, 'buClr');
      const ls = path(p, 'lnSpc', 'spcPct');
      if (ls) out.lnSpc = num(ls.getAttribute('val')) / 100000;
      const sb = path(p, 'spcBef', 'spcPts');
      if (sb) out.spcBef = num(sb.getAttribute('val')) / 100;
      const sa = path(p, 'spcAft', 'spcPts');
      if (sa) out.spcAft = num(sa.getAttribute('val')) / 100;
    };
    for (const p of chain) apply(p);
    apply(pPr);
    return out;
  }

  function fontFamily(name) {
    if (!name) name = '+mn-lt';
    if (name === '+mj-lt') name = theme.major;
    else if (name.startsWith('+mn') || name.startsWith('+mj')) name = theme.minor;
    const l = (name || '').toLowerCase();
    const generic = /mono|courier|consol/.test(l) ? 'monospace' : /times|georgia|cambria|garamond|serif|book/.test(l) && !/sans/.test(l) ? 'serif' : 'sans-serif';
    return `'${(name || 'Calibri').replace(/'/g, '')}', ${generic}`;
  }

  function autoNum(type, n) {
    const roman = (x) => { const v = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [k, r] of v) while (x >= k) { s += r; x -= k; } return s; };
    const t = type || 'arabicPeriod';
    let s = String(n);
    if (/alphaLc/.test(t)) s = String.fromCharCode(96 + ((n - 1) % 26) + 1);
    else if (/alphaUc/.test(t)) s = String.fromCharCode(64 + ((n - 1) % 26) + 1);
    else if (/romanLc/.test(t)) s = roman(n);
    else if (/romanUc/.test(t)) s = roman(n).toUpperCase();
    if (/ParenBoth/.test(t)) return `(${s})`;
    if (/ParenR/.test(t)) return `${s})`;
    if (/Period/.test(t)) return `${s}.`;
    return s;
  }

  function textBody(txBody, ctx, ph, box, styleEl) {
    if (!txBody) return null;
    const bodyPr = kid(txBody, 'bodyPr');
    const inherited = (holderFn) => { const sp = ph && holderFn && holderFn(ph); return sp ? path(sp, 'txBody', 'bodyPr') : null; };
    const bp = [inherited(ctx.masterPh), inherited(ctx.layoutPh), bodyPr].filter(Boolean);
    const attr = (n, d) => { let v = d; for (const b of bp) if (b.getAttribute(n) != null) v = b.getAttribute(n); return v; };
    const anchor = attr('anchor', 't');
    const ins = (n, d) => num(attr(n, d)) / EMU;
    const fontScale = (() => { for (let k = bp.length - 1; k >= 0; k--) { const na = kid(bp[k], 'normAutofit'); if (na) return num(na.getAttribute('fontScale'), 100000) / 100000; } return 1; })();
    const vert = attr('vert', 'horz');
    const div = h('div', { class: 'tx' });
    div.style.cssText = `padding:${ins('tIns', 45720)}px ${ins('rIns', 91440)}px ${ins('bIns', 45720)}px ${ins('lIns', 91440)}px;justify-content:${anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start'};`;
    if (attr('wrap', 'square') === 'none') div.style.whiteSpace = 'nowrap';
    if (vert === 'vert' || vert === 'eaVert') div.style.writingMode = 'vertical-rl';
    if (vert === 'vert270') { div.style.writingMode = 'vertical-rl'; div.style.transform = 'rotate(180deg)'; }
    const shapeLst = kid(txBody, 'lstStyle');
    const counters = {};
    let fontRefColor = null;
    if (styleEl && kid(styleEl, 'fontRef')) fontRefColor = color(kid(styleEl, 'fontRef'), ctx);
    let hasText = false;
    for (const p of kids(txBody, 'p')) {
      const pPr = kid(p, 'pPr');
      const lvl = num(pPr && pPr.getAttribute('lvl'));
      const chain = chainFor(ctx, ph, shapeLst, lvl);
      const pp = mergePara(chain, pPr);
      const pe = h('div', { class: 'p' });
      const runs = Array.from(p.children).filter((c) => /^(r|br|fld)$/.test(c.localName));
      const firstR = runs.find((r) => r.localName !== 'br');
      const firstStyle = mergeRun(chain, pPr, firstR ? kid(firstR, 'rPr') : kid(p, 'endParaRPr'));
      const fsPx = (sz) => (sz / 100) * fontScale * 4 / 3;
      pe.style.cssText = `text-align:${{ ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[pp.algn] || 'left'};` +
        `padding-left:${(pp.marL + Math.min(0, pp.indent)) / EMU}px;text-indent:${pp.indent / EMU}px;` +
        `margin-top:${pp.spcBef * 4 / 3}px;margin-bottom:${pp.spcAft * 4 / 3}px;` +
        `font-size:${fsPx(firstStyle.sz)}px;line-height:${pp.lnSpc ? pp.lnSpc * 1.2 : 1.2};`;
      const hasRuns = runs.some((r) => r.localName !== 'br' && r.textContent.length);
      if (hasRuns && !pp.buNone && (pp.bu || pp.auto) && (ph ? true : true)) {
        counters[lvl] = (counters[lvl] || num(kid(pPr, 'buAutoNum') && kid(pPr, 'buAutoNum').getAttribute('startAt'), 1) - 1) + 1;
        let ch = pp.auto ? autoNum(pp.auto, counters[lvl]) : pp.bu;
        if (/[-]/.test(ch) || /wingdings|symbol/i.test(pp.buFont || '')) ch = ch === 'Ø' ? '➢' : ch === 'ü' ? '✓' : ch === '§' ? '▪' : ch === 'q' ? '❑' : '•';
        const bc = pp.buColor ? color(pp.buColor, ctx) : (firstStyle.colorEl ? color(firstStyle.colorEl, ctx) : fontRefColor);
        pe.append(h('span', { class: 'bu', text: ch, style: `min-width:${Math.max(0, -pp.indent / EMU)}px;${bc ? 'color:' + css(bc) + ';' : ''}` }));
      } else if (!pp.auto) {
        delete counters[lvl];
      }
      for (const r of runs) {
        if (r.localName === 'br') { pe.append(h('br')); continue; }
        const t = path(r, 't');
        const text = t ? t.textContent : '';
        if (!text) continue;
        hasText = true;
        const s = mergeRun(chain, pPr, kid(r, 'rPr'));
        const sp = h('span', { text });
        const ownLvl = shapeLst && lvlProps(shapeLst, lvl);
        const ownColor = kid(kid(r, 'rPr'), 'solidFill') || kid(kid(pPr, 'defRPr'), 'solidFill') || kid(kid(ownLvl, 'defRPr'), 'solidFill');
        let c = ownColor ? color(ownColor, ctx) : (fontRefColor || (s.colorEl ? color(s.colorEl, ctx) : null));
        if (!c) c = color(null) || { rgb: hexToRgb(theme.colors[(ctx.map && ctx.map.tx1) || 'dk1'] || '000000'), a: 1 };
        sp.style.cssText = `font-size:${fsPx(s.sz)}px;font-family:${fontFamily(s.font)};color:${css(c)};` +
          (s.b ? 'font-weight:bold;' : '') + (s.i ? 'font-style:italic;' : '') +
          (s.u || s.strike ? `text-decoration:${[s.u && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ')};` : '') +
          (s.baseline ? `vertical-align:${s.baseline > 0 ? 'super' : 'sub'};font-size:${fsPx(s.sz) * 0.65}px;` : '');
        const link = kid(kid(r, 'rPr'), 'hlinkClick');
        const target = link && ctx.rels.get(rid(link, 'id'));
        if (link && ctx.externalLinks && ctx.externalLinks.get(rid(link, 'id'))) {
          pe.append(h('a', { href: ctx.externalLinks.get(rid(link, 'id')) }, sp));
        } else pe.append(sp);
        void target;
      }
      if (!pe.childNodes.length) pe.append(h('br'));
      div.append(pe);
    }
    return hasText ? div : (ph ? null : div);
  }

  /* ---------------- kształty ---------------- */
  function xfrmOf(spPr) {
    const x = kid(spPr, 'xfrm');
    if (!x) return null;
    const off = kid(x, 'off'), ext = kid(x, 'ext');
    if (!off || !ext) return null;
    return {
      x: num(off.getAttribute('x')), y: num(off.getAttribute('y')), w: num(ext.getAttribute('cx')), h: num(ext.getAttribute('cy')),
      rot: num(x.getAttribute('rot')) / 60000, flipH: x.getAttribute('flipH') === '1', flipV: x.getAttribute('flipV') === '1',
      chOff: kid(x, 'chOff'), chExt: kid(x, 'chExt'),
    };
  }

  function place(el, xf, tr) {
    const x = tr.x(xf.x), y = tr.y(xf.y), w = xf.w * tr.sx, hh = xf.h * tr.sy;
    el.style.left = (x / EMU) + 'px';
    el.style.top = (y / EMU) + 'px';
    el.style.width = Math.max(0, w / EMU) + 'px';
    el.style.height = Math.max(0, hh / EMU) + 'px';
    const t = [];
    if (xf.rot) t.push(`rotate(${xf.rot}deg)`);
    if (xf.flipH) t.push('scaleX(-1)');
    if (xf.flipV) t.push('scaleY(-1)');
    if (t.length) el.style.transform = t.join(' ');
  }

  function phKey(ph) { return { type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') }; }
  function makePhFinder(spTree) {
    const list = [];
    const walk = (t) => {
      for (const c of Array.from(t ? t.children : [])) {
        if (c.localName === 'grpSp') walk(c);
        const ph = c.querySelector && Array.from(c.getElementsByTagNameNS(NS.p, 'ph'))[0];
        if (ph && (c.localName === 'sp' || c.localName === 'pic')) list.push({ ph: phKey(ph), sp: c });
      }
    };
    walk(spTree);
    return (ph) => {
      const k = phKey(ph);
      return (k.idx != null && list.find((e) => e.ph.idx === k.idx && (e.ph.type === k.type || k.type === 'body' || e.ph.type === 'body'))?.sp)
        || list.find((e) => e.ph.type === k.type)?.sp
        || (k.type === 'ctrTitle' && list.find((e) => e.ph.type === 'title')?.sp)
        || (k.type === 'subTitle' && list.find((e) => e.ph.type === 'body')?.sp)
        || null;
    };
  }

  async function renderTree(spTree, out, ctx, tr, layer) {
    for (const c of Array.from(spTree ? spTree.children : [])) {
      try { await renderShape(c, out, ctx, tr, layer); } catch (e) { console.warn('kształt pominięty', e); }
    }
  }

  async function renderShape(c, out, ctx, tr, layer) {
    const ln = c.localName;
    if (ln === 'AlternateContent') {
      const fb = kid(c, 'Fallback') || kid(c, 'Choice');
      if (fb) await renderTree(fb, out, ctx, tr, layer);
      return;
    }
    const nv = Array.from(c.children).find((x) => /^nv/.test(x.localName));
    const ph = nv ? Array.from(nv.getElementsByTagNameNS(NS.p, 'ph'))[0] : null;
    if (layer !== 'slide' && ph) return; // pola zastępcze wzorca/układu nie są rysowane
    if (ln === 'grpSp') {
      const xf = xfrmOf(kid(c, 'grpSpPr'));
      let ntr = tr;
      if (xf && xf.chOff && xf.chExt) {
        const cx = num(xf.chOff.getAttribute('x')), cy = num(xf.chOff.getAttribute('y'));
        const cw = num(xf.chExt.getAttribute('cx')) || 1, chh = num(xf.chExt.getAttribute('cy')) || 1;
        const sx = xf.w / cw, sy = xf.h / chh;
        const ox = tr.x(xf.x), oy = tr.y(xf.y);
        ntr = { x: (v) => ox + (v - cx) * sx * tr.sx, y: (v) => oy + (v - cy) * sy * tr.sy, sx: sx * tr.sx, sy: sy * tr.sy };
      }
      await renderTree(c, out, ctx, ntr, layer);
      return;
    }
    if (!/^(sp|pic|cxnSp|graphicFrame)$/.test(ln)) return;
    const spPr = kid(c, 'spPr');
    let xf = xfrmOf(ln === 'graphicFrame' ? c : spPr);
    if (!xf && ph) {
      for (const holder of [ctx.layoutPh, ctx.masterPh]) {
        const sp = holder && holder(ph);
        const x2 = sp && xfrmOf(kid(sp, 'spPr'));
        if (x2) { xf = x2; break; }
      }
    }
    if (!xf) return;
    const el = h('div', { class: 'sh' });
    place(el, xf, tr);
    const styleEl = kid(c, 'style');

    if (ln === 'pic') {
      const bf = kid(c, 'blipFill');
      const url = await blob(ctx.rels.get(rid(kid(bf, 'blip')))?.target);
      if (url) {
        const img = h('img', { src: url, alt: '' });
        const sr = kid(bf, 'srcRect');
        if (sr) {
          const l = num(sr.getAttribute('l')) / 100000, t = num(sr.getAttribute('t')) / 100000, r = num(sr.getAttribute('r')) / 100000, b = num(sr.getAttribute('b')) / 100000;
          img.style.cssText = `position:absolute;width:${100 / (1 - l - r)}%;height:${100 / (1 - t - b)}%;left:${-l / (1 - l - r) * 100}%;top:${-t / (1 - t - b) * 100}%;`;
        } else img.style.cssText = 'width:100%;height:100%;object-fit:fill;';
        el.append(img);
        el.style.overflow = 'hidden';
      } else el.append(h('div', { class: 'ph-box', text: 'obraz' }));
      out.append(el);
      return;
    }

    if (ln === 'graphicFrame') {
      const gd = path(c, 'graphic', 'graphicData');
      const tbl = gd && kid(gd, 'tbl');
      if (tbl) el.append(table(tbl, ctx));
      else {
        const uri = gd ? gd.getAttribute('uri') || '' : '';
        el.append(h('div', { class: 'ph-box', text: /chart/.test(uri) ? 'Wykres' : /diagram/.test(uri) ? 'Grafika SmartArt' : 'Obiekt' }));
      }
      out.append(el);
      return;
    }

    // linia lub kształt
    const prst = path(spPr, 'prstGeom');
    const geom = prst ? prst.getAttribute('prst') : (kid(spPr, 'custGeom') ? 'cust' : 'rect');
    const line = lineCss(spPr, ctx, styleEl);
    if (ln === 'cxnSp' || /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(geom)) {
      if (line) {
        const w = parseFloat(el.style.width), hh = parseFloat(el.style.height);
        el.innerHTML = `<svg width="${Math.max(w, 1)}" height="${Math.max(hh, 1)}" style="overflow:visible;position:absolute;left:0;top:0"><line x1="0" y1="0" x2="${w}" y2="${hh}" stroke="${line.color}" stroke-width="${line.w}"${line.style === 'dashed' ? ' stroke-dasharray="6 4"' : ''}/></svg>`;
        out.append(el);
      }
      return;
    }
    const fill = await fillCss(spPr, ctx, styleEl);
    if (fill && geom !== 'cust') el.style.background = fill;
    if (fill && geom === 'cust') el.style.background = fill; // przybliżenie dowolnego kształtu prostokątem
    if (line) el.style.border = `${line.w}px ${line.style} ${line.color}`;
    if (geom === 'ellipse') el.style.borderRadius = '50%';
    else if (geom === 'roundRect') el.style.borderRadius = Math.min(parseFloat(el.style.width), parseFloat(el.style.height)) * 0.16 + 'px';
    else if (/triangle/.test(geom)) { el.style.clipPath = 'polygon(50% 0, 100% 100%, 0 100%)'; el.style.border = ''; }
    else if (/rightArrow/.test(geom)) { el.style.clipPath = 'polygon(0 25%, 65% 25%, 65% 0, 100% 50%, 65% 100%, 65% 75%, 0 75%)'; el.style.border = ''; }
    else if (/leftArrow/.test(geom)) { el.style.clipPath = 'polygon(100% 25%, 35% 25%, 35% 0, 0 50%, 35% 100%, 35% 75%, 100% 75%)'; el.style.border = ''; }
    else if (/diamond/.test(geom)) { el.style.clipPath = 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)'; el.style.border = ''; }
    else if (/chevron|homePlate/.test(geom)) { el.style.clipPath = 'polygon(0 0, 80% 0, 100% 50%, 80% 100%, 0 100%' + (geom === 'chevron' ? ', 20% 50%)' : ')'); el.style.border = ''; }
    const tx = textBody(kid(c, 'txBody'), ctx, ph, el, styleEl);
    if (tx) el.append(tx);
    if (!fill && !line && !tx) return;
    out.append(el);
  }

  function table(tbl, ctx) {
    const t = h('table', { class: 'tbl' });
    const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => num(g.getAttribute('w')) / EMU);
    const cg = h('colgroup', null, ...grid.map((w) => h('col', { style: `width:${w}px` })));
    t.append(cg);
    const tblPr = kid(tbl, 'tblPr');
    const firstRow = tblPr && tblPr.getAttribute('firstRow') === '1';
    const band = tblPr && tblPr.getAttribute('bandRow') === '1';
    const accent = theme.colors.accent1 || '4472C4';
    kids(tbl, 'tr').forEach((tr, ri) => {
      const row = h('tr', { style: `height:${num(tr.getAttribute('h')) / EMU}px` });
      for (const tc of kids(tr, 'tc')) {
        if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') continue;
        const td = h('td');
        if (num(tc.getAttribute('gridSpan')) > 1) td.colSpan = num(tc.getAttribute('gridSpan'));
        if (num(tc.getAttribute('rowSpan')) > 1) td.rowSpan = num(tc.getAttribute('rowSpan'));
        const tcPr = kid(tc, 'tcPr');
        const sf = kid(tcPr, 'solidFill');
        let bg = sf ? css(color(sf, ctx)) : null;
        let fg = null;
        if (!bg && firstRow && ri === 0) { bg = '#' + accent; fg = '#fff'; }
        else if (!bg && band && ri % 2 === (firstRow ? 1 : 0)) bg = `rgba(${hexToRgb(accent).join(',')},.16)`;
        if (bg) td.style.background = bg;
        for (const [side, tag] of [['left', 'lnL'], ['right', 'lnR'], ['top', 'lnT'], ['bottom', 'lnB']]) {
          const l = kid(tcPr, tag);
          if (l && !kid(l, 'noFill') && kid(l, 'solidFill')) td.style['border-' + side] = `${Math.max(1, num(l.getAttribute('w'), 12700) / EMU)}px solid ${css(color(kid(l, 'solidFill'), ctx))}`;
        }
        const anchor = tcPr && tcPr.getAttribute('anchor');
        td.style.verticalAlign = anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top';
        const tx = textBody(kid(tc, 'txBody'), ctx, null, td, null);
        if (tx) {
          tx.style.position = 'static';
          tx.style.padding = '4px 8px';
          if (fg) tx.querySelectorAll('span').forEach((s) => { if (!kid(kid(tc, 'txBody'), 'p')?.querySelector('solidFill')) s.style.color = fg; });
          td.append(tx);
        }
        row.append(td);
      }
      t.append(row);
    });
    return t;
  }

  async function background(cSld, ctx) {
    const bg = kid(cSld, 'bg');
    if (!bg) return null;
    const bgPr = kid(bg, 'bgPr');
    if (bgPr) return fillCss(bgPr, ctx);
    const ref = kid(bg, 'bgRef');
    if (ref) {
      const idx = num(ref.getAttribute('idx'));
      const c = color(ref, ctx);
      if (idx >= 1001 && theme.bgFills[idx - 1001]) return (await fillCss(theme.bgFills[idx - 1001], ctx, null, c)) || css(c);
      return css(c);
    }
    return null;
  }

  function clrMap(el) {
    if (!el) return null;
    const m = {};
    for (const a of Array.from(el.attributes)) m[a.name] = a.value;
    return m;
  }

  async function loadTheme(p) {
    const d = await xml(p);
    const t = { colors: {}, major: 'Calibri Light', minor: 'Calibri', bgFills: [] };
    if (!d) return t;
    const cs = d.getElementsByTagNameNS(NS.a, 'clrScheme')[0];
    if (cs) for (const c of Array.from(cs.children)) {
      const v = Array.from(c.children)[0];
      if (v) t.colors[c.localName] = v.getAttribute('lastClr') || v.getAttribute('val') || '000000';
    }
    const fs = d.getElementsByTagNameNS(NS.a, 'fontScheme')[0];
    if (fs) {
      const mj = path(fs, 'majorFont', 'latin'), mn = path(fs, 'minorFont', 'latin');
      if (mj) t.major = mj.getAttribute('typeface');
      if (mn) t.minor = mn.getAttribute('typeface');
    }
    const bfl = d.getElementsByTagNameNS(NS.a, 'bgFillStyleLst')[0];
    if (bfl) t.bgFills = Array.from(bfl.children).map((f) => { const w = document.createElementNS(NS.a, 'a:spPr'); w.append(f.cloneNode(true)); return w; });
    return t;
  }

  async function notesText(slideRels) {
    const n = relByType(slideRels, 'notesSlide');
    if (!n) return '';
    const d = await xml(n.target);
    if (!d) return '';
    const out = [];
    for (const sp of Array.from(d.getElementsByTagNameNS(NS.p, 'sp'))) {
      const ph = Array.from(sp.getElementsByTagNameNS(NS.p, 'ph'))[0];
      if (!ph || ph.getAttribute('type') !== 'body') continue;
      for (const p of Array.from(sp.getElementsByTagNameNS(NS.a, 'p'))) out.push(Array.from(p.getElementsByTagNameNS(NS.a, 't')).map((t) => t.textContent).join(''));
    }
    return out.join('\n').trim();
  }

  return {
    async load(data, onProgress) {
      zip = await JSZip.loadAsync(data);
      const presPath = 'ppt/presentation.xml';
      const pres = await xml(presPath);
      if (!pres) throw new Error('To nie jest prezentacja PowerPoint (brak ppt/presentation.xml)');
      const sz = pres.getElementsByTagNameNS(NS.p, 'sldSz')[0];
      const W = num(sz && sz.getAttribute('cx'), 12192000) / EMU, H = num(sz && sz.getAttribute('cy'), 6858000) / EMU;
      presDefaults = pres.getElementsByTagNameNS(NS.p, 'defaultTextStyle')[0] || null;
      const presRels = await rels(presPath);
      const ids = Array.from(pres.getElementsByTagNameNS(NS.p, 'sldId'));
      const slides = [];
      const masterCache = new Map(), layoutCache = new Map();
      for (let i = 0; i < ids.length; i++) {
        if (onProgress) onProgress(i / ids.length);
        const r = presRels.get(rid(ids[i], 'id'));
        if (!r || !r.target) continue;
        const sPath = r.target;
        const sDoc = await xml(sPath);
        if (!sDoc) continue;
        const sRels = await rels(sPath);
        const lRel = relByType(sRels, 'slideLayout');
        let layout = lRel && layoutCache.get(lRel.target);
        if (lRel && !layout) {
          const d = await xml(lRel.target), lr = await rels(lRel.target);
          layout = { doc: d, rels: lr, path: lRel.target };
          layoutCache.set(lRel.target, layout);
        }
        const mRel = layout && relByType(layout.rels, 'slideMaster');
        let master = mRel && masterCache.get(mRel.target);
        if (mRel && !master) {
          const d = await xml(mRel.target), mr = await rels(mRel.target);
          master = { doc: d, rels: mr, path: mRel.target };
          masterCache.set(mRel.target, master);
          const th = relByType(mr, 'theme');
          if (th && !theme) theme = await loadTheme(th.target);
        }
        if (!theme) theme = await loadTheme('ppt/theme/theme1.xml');
        const sRoot = sDoc.documentElement, lRoot = layout && layout.doc.documentElement, mRoot = master && master.doc.documentElement;
        const map = Object.assign({}, clrMap(mRoot && kid(mRoot, 'clrMap')) || {}, clrMap(path(lRoot, 'clrMapOvr', 'overrideClrMapping')) || {}, clrMap(path(sRoot, 'clrMapOvr', 'overrideClrMapping')) || {});
        const ext = new Map();
        const relDoc = await xml(sPath.replace(/[^/]+$/, (f) => '_rels/' + f + '.rels'));
        if (relDoc) for (const x of Array.from(relDoc.documentElement.children)) if (x.getAttribute('TargetMode') === 'External' && /^https?:/i.test(x.getAttribute('Target') || '')) ext.set(x.getAttribute('Id'), x.getAttribute('Target'));
        const base = {
          map,
          masterTxStyles: mRoot && kid(mRoot, 'txStyles'),
          masterPh: mRoot ? makePhFinder(path(mRoot, 'cSld', 'spTree')) : null,
          layoutPh: lRoot ? makePhFinder(path(lRoot, 'cSld', 'spTree')) : null,
          externalLinks: ext,
        };
        const slideEl = h('div', { class: 'slide', style: `width:${W}px;height:${H}px` });
        const bg = (await background(kid(sRoot, 'cSld'), { ...base, rels: sRels }))
          || (lRoot && await background(kid(lRoot, 'cSld'), { ...base, rels: layout.rels }))
          || (mRoot && await background(kid(mRoot, 'cSld'), { ...base, rels: master.rels }))
          || '#fff';
        slideEl.style.background = bg;
        const tr0 = { x: (v) => v, y: (v) => v, sx: 1, sy: 1 };
        const hidden = sRoot.getAttribute('show') === '0';
        if (mRoot && sRoot.getAttribute('showMasterSp') !== '0' && (!lRoot || lRoot.getAttribute('showMasterSp') !== '0')) {
          await renderTree(path(mRoot, 'cSld', 'spTree'), slideEl, { ...base, rels: master.rels }, tr0, 'master');
        }
        if (lRoot && sRoot.getAttribute('showMasterSp') !== '0') await renderTree(path(lRoot, 'cSld', 'spTree'), slideEl, { ...base, rels: layout.rels }, tr0, 'layout');
        await renderTree(path(sRoot, 'cSld', 'spTree'), slideEl, { ...base, rels: sRels }, tr0, 'slide');
        slides.push({ el: slideEl, notes: await notesText(sRels), hidden });
      }
      return { width: W, height: H, slides };
    },
  };
})();
