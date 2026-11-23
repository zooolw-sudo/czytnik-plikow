/*
 * Konwerter RTF -> HTML: akapity i ich wyrównanie/wcięcia, czcionki, rozmiary,
 * pogrubienie, kursywa, podkreślenie, kolory, indeksy, tabele, obrazy PNG/JPEG,
 * linki (pola HYPERLINK), podziały stron, polskie strony kodowe (\ansicpg1250,
 * \fcharset238) i znaki Unicode (\uN).
 */
'use strict';

const Rtf = (() => {
  const CHARSET_CP = { 0: 1252, 238: 1250, 204: 1251, 161: 1253, 162: 1254, 186: 1257, 177: 1255, 178: 1256, 222: 874, 163: 1258, 128: 932, 134: 936, 136: 950, 129: 949 };
  const SYMBOL = { 0xb7: '•', 0xa7: '▪', 0xfc: '✓', 0xd8: '➢', 0x6f: '○', 0x76: '❖', 0x6e: '■', 0xa8: '♦' };
  const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'listtable', 'listoverridetable', 'rsidtbl', 'generator',
    'xmlnstbl', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'pgdsctbl', 'revtbl', 'filetbl', 'mmathPr',
    'nonshppict', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'bkmkstart',
    'bkmkend', 'xe', 'tc', 'object', 'sp', 'sn', 'userprops', 'docvar', 'wgrffmtfilter', 'aftnsep', 'ftnsep', 'ftnsepc', 'aftnsepc']);

  function decoderFor(cp) {
    try { return new TextDecoder('windows-' + cp); } catch (e) {
      try { return new TextDecoder({ 932: 'shift_jis', 936: 'gbk', 950: 'big5', 949: 'euc-kr', 874: 'windows-874' }[cp] || 'windows-1252'); } catch (e2) { return new TextDecoder('windows-1252'); }
    }
  }

  function convert(bytes) {
    // RTF jest 7-bitowy; czytamy bajty jako znaki 1:1
    let src = '';
    for (let i = 0; i < bytes.length; i += 0x8000) src += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    if (!src.startsWith('{\\rtf')) throw new Error('To nie jest plik RTF');

    const fonts = {}, colors = [];
    let ansiCp = 1252, defFont = null;
    const page = { w: 12240, h: 15840, l: 1800, r: 1800, t: 1440, b: 1440 };
    const def = () => ({ f: null, fs: 24, b: false, i: false, ul: false, st: false, cf: 0, cb: 0, sup: 0, uc: 1, skip: false, dest: null,
      align: 'left', li: 0, ri: 0, fi: 0, sb: 0, sa: 0, intbl: false, caps: false, v: false });
    let st = def();
    const stack = [];

    const pages = [[]];               // kolejne strony -> lista bloków HTML
    let paraRuns = [];                // [{style, text}]
    let byteBuf = [];                 // bajty \'hh do zdekodowania
    let skipChars = 0;
    let tableRows = null, rowCells = [], cellHtml = [], cellX = [];
    let pict = null, field = null, fontDef = null, colorDef = null;

    const registerFont = () => {
      if (!fontDef || fontDef.done) return;
      fonts[fontDef.id] = { name: fontDef.name.replace(/;\s*$/, '').trim(), charset: fontDef.charset, generic: fontDef.generic };
      fontDef.done = true;
    };
    const curCp = () => {
      const f = fonts[st.f != null ? st.f : defFont];
      if (f && f.charset === 2) return 'symbol';
      return f && CHARSET_CP[f.charset] ? CHARSET_CP[f.charset] : ansiCp;
    };
    const runStyle = () => {
      let s = '';
      const f = fonts[st.f != null ? st.f : defFont];
      if (f && f.name && f.charset !== 2) s += `font-family:'${f.name.replace(/['"<>&]/g, '')}',${f.generic};`;
      if (st.fs !== 24) s += `font-size:${st.fs / 2}pt;`;
      if (st.b) s += 'font-weight:bold;';
      if (st.i) s += 'font-style:italic;';
      const deco = [st.ul && 'underline', st.st && 'line-through'].filter(Boolean);
      if (deco.length) s += `text-decoration:${deco.join(' ')};`;
      if (st.cf && colors[st.cf]) s += `color:${colors[st.cf]};`;
      if (st.cb && colors[st.cb]) s += `background:${colors[st.cb]};`;
      if (st.sup > 0) s += 'vertical-align:super;font-size:smaller;';
      if (st.sup < 0) s += 'vertical-align:sub;font-size:smaller;';
      if (st.caps) s += 'text-transform:uppercase;';
      return s;
    };
    const flushBytes = () => {
      if (!byteBuf.length) return;
      const cp = curCp();
      const text = cp === 'symbol' ? byteBuf.map((b) => SYMBOL[b] || (b >= 0x80 ? '•' : String.fromCharCode(b))).join('')
        : decoderFor(cp).decode(new Uint8Array(byteBuf));
      byteBuf = [];
      addText(text, true);
    };
    function addText(t, decoded) {
      if (!decoded && byteBuf.length) flushBytes();
      if (st.v) return;                                   // tekst ukryty
      if (pict) return;
      if (fontDef) { fontDef.name += t; return; }
      const style = runStyle();
      const last = paraRuns[paraRuns.length - 1];
      const link = field && field.inResult ? field.href : null;
      if (last && last.style === style && last.link === link) last.text += t;
      else paraRuns.push({ style, text: t, link });
    }
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function runsHtml() {
      let html = '';
      for (const r of paraRuns) {
        if (r.raw) { html += r.raw; continue; }
        let t = esc(r.text).replace(/\t/g, '<span class="odt-tab">\t</span>').replace(/\n/g, '<br>');
        if (r.style) t = `<span style="${r.style}">${t}</span>`;
        if (r.link) t = `<a href="${esc(r.link)}" target="_blank">${t}</a>`;
        html += t;
      }
      return html;
    }
    function endPara(forceEmpty) {
      flushBytes();
      if (!paraRuns.length && !forceEmpty) return;
      const tw = (v) => (v / 20).toFixed(1) + 'pt';
      let ps = `text-align:${st.align};`;
      if (st.li) ps += `margin-left:${tw(st.li)};`;
      if (st.ri) ps += `margin-right:${tw(st.ri)};`;
      if (st.fi) ps += `text-indent:${tw(st.fi)};`;
      if (st.sb) ps += `margin-top:${tw(st.sb)};`;
      if (st.sa) ps += `margin-bottom:${tw(st.sa)};`;
      const html = `<p style="${ps}">${runsHtml() || '<br>'}</p>`;
      paraRuns = [];
      if (st.intbl) cellHtml.push(html);
      else {
        closeTable();
        if (st.pagebb && pages[pages.length - 1].length) pages.push([]);
        pages[pages.length - 1].push(html);
      }
    }
    function closeTable() {
      if (!tableRows) return;
      pages[pages.length - 1].push(`<div class="odt-table-wrap"><table class="rtf-table">${tableRows.join('')}</table></div>`);
      tableRows = null;
    }
    function endCell() {
      flushBytes();
      if (paraRuns.length) endPara(false);
      rowCells.push(cellHtml.join(''));
      cellHtml = [];
    }
    function endRow() {
      if (paraRuns.length || cellHtml.length) endCell();
      let prev = 0;
      const tds = rowCells.map((c, i) => {
        const x = cellX[i];
        const w = x ? `width:${((x - prev) / 20).toFixed(0)}pt` : '';
        prev = x || prev;
        return `<td style="${w}">${c || '&nbsp;'}</td>`;
      });
      if (!tableRows) tableRows = [];
      tableRows.push(`<tr>${tds.join('')}</tr>`);
      rowCells = [];
    }

    let i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === '{') {
        flushBytes();
        stack.push({ st: { ...st }, pict, field, fontDef, colorDef });
        st = { ...st };
        st.dest = null;
        i++;
        if (src.startsWith('\\*', i)) {
          // ignorowany cel: pomijamy cały blok, chyba że go obsługujemy
          const m = /^\\\*\\([a-zA-Z]+)/.exec(src.slice(i, i + 40));
          const w = m ? m[1] : '';
          if (w === 'shppict') { i += 2; continue; }
          if (w === 'fldinst') { st.dest = 'fldinst'; if (field) field.inst = ''; i += 2; continue; }
          st.skip = true;
        }
        continue;
      }
      if (c === '}') {
        flushBytes();
        if (fontDef && (!stack.length || stack[stack.length - 1].fontDef !== fontDef)) registerFont();
        if (pict && (!stack.length || stack[stack.length - 1].pict !== pict)) {
          const hex = pict.hex.replace(/[^0-9a-fA-F]/g, '');
          if (pict.type && hex.length > 8) {
            const u8 = new Uint8Array(hex.length >> 1);
            for (let k = 0; k < u8.length; k++) u8[k] = parseInt(hex.substr(k * 2, 2), 16);
            const url = URL.createObjectURL(new Blob([u8], { type: pict.type }));
            const w = pict.wgoal ? (pict.wgoal * (pict.scalex || 100) / 100 / 15) : null;
            const target = paraRuns;
            target.push({ style: '', text: '', raw: `<img src="${url}" style="${w ? `width:${w.toFixed(0)}px;` : ''}max-width:100%;height:auto">` });
          } else if (hex.length > 8) {
            paraRuns.push({ style: '', text: '', raw: '<span class="odt-noimg">obraz w formacie WMF/EMF</span>' });
          }
        }
        if (field && field.inResult === false && st.dest === 'fldinst') {
          const m = /HYPERLINK\s+"([^"]+)"/i.exec(field.inst || '');
          field.href = m && /^(https?:|mailto:)/i.test(m[1]) ? m[1] : null;
        }
        const prev = stack.pop();
        if (!prev) break;
        st = prev.st;
        pict = prev.pict;
        field = prev.field;
        fontDef = prev.fontDef;
        colorDef = prev.colorDef;
        i++;
        continue;
      }
      if (c === '\\') {
        const nx = src[i + 1];
        if (/[a-zA-Z]/.test(nx)) {
          let j = i + 1;
          while (j < n && /[a-zA-Z]/.test(src[j])) j++;
          const word = src.slice(i + 1, j);
          let param = null;
          const pm = /^-?\d+/.exec(src.slice(j, j + 12));
          if (pm) { param = Number(pm[0]); j += pm[0].length; }
          if (src[j] === ' ') j++;
          i = j;
          if (st.skip) continue;
          if (skipChars > 0 && word !== 'u') { /* słowo sterujące nie liczy się do pominięcia */ }
          handleWord(word, param);
          continue;
        }
        // symbol sterujący
        i += 2;
        if (st.skip) { if (nx === "'") i += 2; continue; }
        if (nx === "'") {
          const hv = parseInt(src.substr(i, 2), 16);
          i += 2;
          if (skipChars > 0) { skipChars--; continue; }
          if (pict) continue;
          if (fontDef) { if (!fontDef.done) fontDef.name += String.fromCharCode(hv); continue; }
          byteBuf.push(hv);
          continue;
        }
        if (skipChars > 0) { skipChars--; continue; }
        if (nx === '\\' || nx === '{' || nx === '}') addText(nx);
        else if (nx === '~') addText(' ');
        else if (nx === '_') addText('‑');
        else if (nx === '\n' || nx === '\r') endPara(true);
        else if (nx === 'tab') addText('\t');
        continue;
      }
      // zwykły znak
      i++;
      if (c === '\r' || c === '\n') continue;
      if (st.skip) continue;
      if (skipChars > 0) { skipChars--; continue; }
      if (pict) { pict.hex += c; continue; }
      if (st.dest === 'fldinst') { if (field) field.inst += c; continue; }
      if (colorDef) {
        if (c === ';') { colors.push(colorDef.set ? `rgb(${colorDef.r},${colorDef.g},${colorDef.b})` : null); colorDef = { r: 0, g: 0, b: 0, set: false }; }
        continue;
      }
      if (fontDef) {
        if (fontDef.done) continue;
        if (c === ';') { registerFont(); continue; }
        fontDef.name += c;
        continue;
      }
      const cp = curCp();
      if (cp === 'symbol' || c.charCodeAt(0) > 127) byteBuf.push(c.charCodeAt(0));
      else { flushBytes(); addText(c); }
    }

    function handleWord(w, p) {
      switch (w) {
        case 'ansicpg': ansiCp = p || 1252; return;
        case 'deff': defFont = p; return;
        case 'fonttbl': st.dest = 'fonttbl'; return;
        case 'colortbl': colorDef = { r: 0, g: 0, b: 0, set: false }; return;
        case 'red': if (colorDef) { colorDef.r = p; colorDef.set = true; } return;
        case 'green': if (colorDef) { colorDef.g = p; colorDef.set = true; } return;
        case 'blue': if (colorDef) { colorDef.b = p; colorDef.set = true; } return;
        case 'f':
          if (st.dest === 'fonttbl' || st.dest === 'fontdef' || (stack.length && stack[stack.length - 1].st.dest === 'fonttbl')) {
            registerFont();
            fontDef = { id: p, name: '', charset: 0, generic: 'serif' };
            if (st.dest !== 'fonttbl') st.dest = 'fontdef';
          } else st.f = p;
          return;
        case 'fldinst': st.dest = 'fldinst'; if (field) field.inst = ''; return;
        case 'fcharset': if (fontDef) fontDef.charset = p; return;
        case 'fswiss': if (fontDef) fontDef.generic = 'sans-serif'; return;
        case 'fmodern': if (fontDef) fontDef.generic = 'monospace'; return;
        case 'froman': if (fontDef) fontDef.generic = 'serif'; return;
        case 'paperw': page.w = p; return;
        case 'paperh': page.h = p; return;
        case 'margl': page.l = p; return;
        case 'margr': page.r = p; return;
        case 'margt': page.t = p; return;
        case 'margb': page.b = p; return;
        case 'pict': pict = { hex: '', type: null }; return;
        case 'pngblip': if (pict) pict.type = 'image/png'; return;
        case 'jpegblip': if (pict) pict.type = 'image/jpeg'; return;
        case 'picwgoal': if (pict) pict.wgoal = p; return;
        case 'picscalex': if (pict) pict.scalex = p; return;
        case 'field': field = { inst: '', href: null, inResult: false }; return;
        case 'fldrslt': if (field) field.inResult = true; return;
        case 'par': endPara(true); return;
        case 'line': addText('\n'); return;
        case 'tab': addText('\t'); return;
        case 'emdash': addText('—'); return;
        case 'endash': addText('–'); return;
        case 'bullet': addText('•'); return;
        case 'lquote': addText('‘'); return;
        case 'rquote': addText('’'); return;
        case 'ldblquote': addText('„'); return;
        case 'rdblquote': addText('”'); return;
        case 'page': endPara(false); closeTable(); pages.push([]); return;
        case 'pard': st.align = 'left'; st.li = st.ri = st.fi = st.sb = st.sa = 0; st.intbl = false; st.pagebb = false; return;
        case 'pagebb': st.pagebb = true; return;
        case 'plain': Object.assign(st, { f: null, fs: 24, b: false, i: false, ul: false, st: false, cf: 0, cb: 0, sup: 0, caps: false, v: false }); return;
        case 'b': st.b = p !== 0; return;
        case 'i': st.i = p !== 0; return;
        case 'ul': case 'uld': case 'uldb': case 'ulw': st.ul = p !== 0; return;
        case 'ulnone': st.ul = false; return;
        case 'strike': st.st = p !== 0; return;
        case 'caps': st.caps = p !== 0; return;
        case 'v': st.v = p !== 0; return;
        case 'fs': st.fs = p || 24; return;
        case 'cf': st.cf = p || 0; return;
        case 'cb': case 'highlight': case 'chcbpat': st.cb = p || 0; return;
        case 'super': st.sup = 1; return;
        case 'sub': st.sup = -1; return;
        case 'nosupersub': st.sup = 0; return;
        case 'qc': st.align = 'center'; return;
        case 'qr': st.align = 'right'; return;
        case 'qj': st.align = 'justify'; return;
        case 'ql': st.align = 'left'; return;
        case 'li': st.li = p || 0; return;
        case 'ri': st.ri = p || 0; return;
        case 'fi': st.fi = p || 0; return;
        case 'sb': st.sb = p || 0; return;
        case 'sa': st.sa = p || 0; return;
        case 'intbl': st.intbl = true; return;
        case 'trowd': cellX = []; return;
        case 'cellx': cellX.push(p); return;
        case 'cell': endCell(); return;
        case 'row': endRow(); return;
        case 'uc': st.uc = p || 0; return;
        case 'u': {
          let code = p;
          if (code < 0) code += 65536;
          flushBytes();
          if (!pict && !fontDef) addText(String.fromCharCode(code));
          skipChars = st.uc;
          return;
        }
        default:
          if (SKIP.has(w)) st.skip = true;
      }
    }

    flushBytes();
    if (paraRuns.length) endPara(false);
    closeTable();
    // obrazy dodane jako „runs” z raw
    return { pages: pages.filter((p, k) => p.length || k === 0), page };
  }

  // runsHtml musi znać obrazy – nadpisanie z obsługą pola raw
  return {
    async render(data, el, mode) {
      const { pages, page } = convert(new Uint8Array(data));
      const tw = (v) => (v / 1440).toFixed(3) + 'in';
      const wrap = document.createElement('div');
      wrap.className = 'odt-wrapper';
      for (const p of pages) {
        const sec = document.createElement('section');
        sec.className = 'odt-page';
        if (mode !== 'read') sec.style.cssText = `width:${tw(page.w)};min-height:${tw(page.h)};padding:${tw(page.t)} ${tw(page.r)} ${tw(page.b)} ${tw(page.l)};`;
        sec.innerHTML = p.join('');
        wrap.append(sec);
      }
      const style = document.createElement('style');
      style.textContent = `.odt-page{font:12pt/1.2 "Times New Roman",serif;color:#000;overflow-wrap:break-word}
        .odt-page p{margin:0;min-height:1.2em}.odt-page .odt-tab{white-space:pre;tab-size:4}
        .rtf-table{border-collapse:collapse}.rtf-table td{border:1px solid #999;padding:2px 5px;vertical-align:top}
        .odt-page .odt-noimg{display:inline-block;padding:10px;background:#f1f3f6;color:#667;font:12px sans-serif;border:1px dashed #bbb}`;
      el.append(style, wrap);
      return pages.length;
    },
  };
})();
