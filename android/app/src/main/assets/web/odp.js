/*
 * Renderer prezentacji OpenDocument (ODP). Korzysta ze stylów i konwertera tekstu
 * z odt.js: ramki z tekstem, obrazy, tabele, kształty (prostokąt, elipsa, strzałki…),
 * linie, grupy, tła slajdów i wzorców, notatki prelegenta.
 */
'use strict';

const Odp = (() => {
  const PX = (v) => { const pt = odtLenPt(v); return pt == null ? null : pt * 4 / 3; };
  const BASE = `
    .slide :where(p,h1,h2,h3,h4,h5,h6) { margin: 0; font-size: inherit; font-weight: inherit; }
    .slide :where(ul.odt-list, ol.odt-list) { margin: 0; padding-left: 1.1em; }
    .slide .odt-frame img { display: block; width: 100%; height: 100%; }
    .slide .odt-table-wrap { width: 100%; height: 100%; }
    .slide table.odt-table { border-collapse: collapse; width: 100%; }
    .slide table.odt-table td { padding: 2px 6px; vertical-align: top; }
    .slide .odt-noimg { display: grid; place-items: center; width: 100%; height: 100%; background: #f1f3f6; color: #667; font: 14px sans-serif; border: 1px dashed #bbb; }
  `;

  function fillOf(g, styles, zip, blobs) {
    if (!g) return null;
    const f = g.fill;
    if (f === 'none') return 'transparent';
    if (f === 'solid' && g['fill-color']) return g['fill-color'];
    if (f === 'gradient' && g['fill-gradient-name']) {
      const gr = styles.gradients[g['fill-gradient-name']];
      if (gr) return `linear-gradient(${180 - (gr.angle || 0)}deg, ${gr.start}, ${gr.end})`;
    }
    if (f === 'bitmap' && g['fill-image-name'] && blobs[g['fill-image-name']]) return `center / cover no-repeat url("${blobs[g['fill-image-name']]}")`;
    if (!f && g['fill-color']) return g['fill-color'];
    return null;
  }

  return {
    async load(data, onProgress) {
      const zip = await JSZip.loadAsync(data);
      const parse = async (name) => {
        const f = zip.file(name);
        return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null;
      };
      const content = await parse('content.xml');
      const stylesDoc = await parse('styles.xml');
      if (!content) throw new Error('Brak treści prezentacji (content.xml)');
      const child = (doc, local) => doc && odtKids(doc.documentElement).find((k) => odtIs(k, 'office', local));

      const st = new OdtStyles(), stM = new OdtStyles();
      for (const s of [st, stM]) {
        s.addFonts(child(stylesDoc, 'font-face-decls'));
        s.addFonts(child(content, 'font-face-decls'));
        s.add(child(stylesDoc, 'styles'));
        s.add(child(stylesDoc, 'automatic-styles'), { onlyLayouts: s === st });
      }
      st.add(child(stylesDoc, 'master-styles'));
      stM.add(child(stylesDoc, 'master-styles'));
      st.add(child(content, 'automatic-styles'));

      // gradienty i obrazy wypełnień ze stylów wspólnych
      const gradients = {}, fillImages = {};
      const common = child(stylesDoc, 'styles');
      for (const g of odtKids(common || document.createElement('x'))) {
        if (odtIs(g, 'draw', 'gradient')) {
          gradients[odtAttr(g, 'draw', 'name')] = { start: odtAttr(g, 'draw', 'start-color') || '#fff', end: odtAttr(g, 'draw', 'end-color') || '#000', angle: (Number(odtAttr(g, 'draw', 'angle')) || 0) / 10 };
        }
        if (odtIs(g, 'draw', 'fill-image')) {
          const p = (odtAttr(g, 'xlink', 'href') || '').replace(/^\.\//, '');
          const f = zip.file(p);
          if (f) fillImages[odtAttr(g, 'draw', 'name')] = URL.createObjectURL(new Blob([await f.async('uint8array')]));
        }
      }
      st.gradients = stM.gradients = gradients;

      // rozmiar slajdu z układu strony wzorca
      const firstMaster = st.masterPages.values().next().value;
      const lay = (firstMaster && st.pageLayouts.get(firstMaster.layout)) || {};
      const W = PX(lay['page-width']) || 1067, H = PX(lay['page-height']) || 600;

      const masterEls = new Map();
      for (const mp of odtKids(child(stylesDoc, 'master-styles') || document.createElement('x'))) {
        if (odtIs(mp, 'style', 'master-page')) masterEls.set(odtAttr(mp, 'style', 'name'), mp);
      }

      const conv = new OdtConverter(st, zip, 'p');
      const convM = new OdtConverter(stM, zip, 'q');
      const slides = [];

      async function shape(n, out, C, S) {
        const ns = n.namespaceURI, l = n.localName;
        if (ns === OdtNS.draw && l === 'g') { for (const k of odtKids(n)) await shape(k, out, C, S); return; }
        if (ns !== OdtNS.draw || !/^(frame|custom-shape|rect|ellipse|line|polygon|polyline|path|circle|connector|measure)$/.test(l)) return;
        const el = h('div', { class: 'sh' });
        let x = PX(odtAttr(n, 'svg', 'x')), y = PX(odtAttr(n, 'svg', 'y'));
        const w = PX(odtAttr(n, 'svg', 'width')), hh = PX(odtAttr(n, 'svg', 'height'));
        const tf = odtAttr(n, 'draw', 'transform');
        let rot = 0;
        if (tf) {
          const r = /rotate\s*\(\s*(-?[\d.e-]+)\s*\)/.exec(tf);
          const t = /translate\s*\(\s*([-\d.e]+\w*)\s+([-\d.e]+\w*)\s*\)/.exec(tf);
          if (r) rot = -Number(r[1]) * 180 / Math.PI;
          if (t) { x = PX(t[1]); y = PX(t[2]); }
        }
        const g = S.resolve(odtAttr(n, 'draw', 'style-name'), 'graphic').graphic || {};
        const pres = odtAttr(n, 'presentation', 'style-name');
        const pr = pres ? S.resolve(pres, 'presentation') : null;
        const gp = Object.assign({}, pr ? pr.graphic : {}, g);

        if (l === 'line' || l === 'connector') {
          const x1 = PX(odtAttr(n, 'svg', 'x1')), y1 = PX(odtAttr(n, 'svg', 'y1')), x2 = PX(odtAttr(n, 'svg', 'x2')), y2 = PX(odtAttr(n, 'svg', 'y2'));
          if ([x1, y1, x2, y2].some((v) => v == null)) return;
          const sw = Math.max(1, PX(gp['stroke-width']) || 1);
          el.style.cssText = 'left:0;top:0;width:1px;height:1px;overflow:visible';
          el.innerHTML = `<svg width="1" height="1" style="overflow:visible;position:absolute"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${gp['stroke-color'] || '#000'}" stroke-width="${sw}"/></svg>`;
          out.append(el);
          return;
        }
        if (x == null || y == null || !w || !hh) return;
        el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${hh}px;${rot ? `transform:rotate(${rot}deg);transform-origin:0 0;` : ''}`;

        if (l === 'frame') {
          const imgs = odtKids(n).filter((k) => odtIs(k, 'draw', 'image'));
          const tb = odtKids(n).find((k) => odtIs(k, 'draw', 'text-box'));
          const tbl = odtKids(n).find((k) => odtIs(k, 'table', 'table'));
          if (tbl) {
            C.table(tbl, el);
            // szablon tabeli: wyróżniony pierwszy wiersz i pasy (gdy komórki nie mają własnego tła)
            const rows = el.querySelectorAll('tr');
            const first = odtAttr(tbl, 'table', 'use-first-row-styles') === 'true';
            const band = odtAttr(tbl, 'table', 'use-banding-rows-styles') === 'true';
            rows.forEach((tr, ri) => tr.querySelectorAll('td').forEach((td) => {
              if (td.className) return; // komórka ma własny styl
              if (first && ri === 0) { td.style.background = '#3465a4'; td.style.color = '#fff'; }
              else if (band && ri % 2 === (first ? 1 : 0)) td.style.background = '#dbe5f3';
            }));
            out.append(el);
            return;
          }
          if (tb && odtKids(tb).length) {
            const box = h('div', { class: 'tx' });
            const pad = ['top', 'right', 'bottom', 'left'].map((s) => gp['padding-' + s] || gp.padding || '0.13cm').join(' ');
            const va = gp['textarea-vertical-align'];
            box.style.cssText = `padding:${pad};justify-content:${va === 'middle' ? 'center' : va === 'bottom' ? 'flex-end' : 'flex-start'};${pr ? odtTextCss(pr.text, S) + odtParaCss(pr.paragraph) : ''}`;
            C.blocks(tb, box, {});
            el.append(box);
            const fill = fillOf(gp, S, zip, fillImages);
            if (fill && fill !== 'transparent' && (g.fill || '') !== '') el.style.background = fill;
            out.append(el);
            return;
          }
          if (imgs.length) {
            const holder = h('span', { class: 'odt-frame', style: 'display:block;width:100%;height:100%' });
            const img = h('img', { alt: '' });
            holder.append(img);
            el.append(holder);
            C.images.push(C.loadImage(imgs, img, holder));
            out.append(el);
          }
          return;
        }
        // kształty z wypełnieniem i tekstem
        const fill = fillOf(gp, S, zip, fillImages);
        if (fill) el.style.background = fill;
        if (gp.stroke && gp.stroke !== 'none') el.style.border = `${Math.max(1, PX(gp['stroke-width']) || 1)}px ${gp.stroke === 'dash' ? 'dashed' : 'solid'} ${gp['stroke-color'] || '#3465a4'}`;
        else if (!gp.stroke && l !== 'custom-shape') el.style.border = '1px solid #3465a4';
        if (gp.opacity) el.style.opacity = parseFloat(gp.opacity) / 100;
        const geo = odtKids(n).find((k) => odtIs(k, 'draw', 'enhanced-geometry'));
        const type = (l === 'ellipse' || l === 'circle' ? 'ellipse' : geo ? odtAttr(geo, 'draw', 'type') || '' : 'rectangle').toLowerCase().replace(/^ooxml-/, '').replace(/-/g, '');
        if (/ellipse|circle/.test(type)) el.style.borderRadius = '50%';
        else if (/round/.test(type)) el.style.borderRadius = Math.min(w, hh) * 0.16 + 'px';
        else if (/rightarrow/.test(type)) { el.style.clipPath = 'polygon(0 25%, 65% 25%, 65% 0, 100% 50%, 65% 100%, 65% 75%, 0 75%)'; el.style.border = ''; }
        else if (/leftarrow/.test(type)) { el.style.clipPath = 'polygon(100% 25%, 35% 25%, 35% 0, 0 50%, 35% 100%, 35% 75%, 100% 75%)'; el.style.border = ''; }
        else if (/triangle/.test(type)) { el.style.clipPath = 'polygon(50% 0, 100% 100%, 0 100%)'; el.style.border = ''; }
        else if (/diamond/.test(type)) { el.style.clipPath = 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)'; el.style.border = ''; }
        if (!gp.fill && !geo && l !== 'rect' && l !== 'ellipse') el.style.background = '#729fcf';
        else if (!gp.fill && geo) el.style.background = '#729fcf';
        const texts = odtKids(n).filter((k) => odtIs(k, 'text', 'p') || odtIs(k, 'text', 'list'));
        if (texts.length) {
          const box = h('div', { class: 'tx' });
          const va = gp['textarea-vertical-align'] || 'middle';
          box.style.cssText = `padding:0.13cm;justify-content:${va === 'top' ? 'flex-start' : va === 'bottom' ? 'flex-end' : 'center'};text-align:center;`;
          for (const t of texts) C.block(t, box, {});
          el.append(box);
        }
        out.append(el);
      }

      const bodyEl = child(content, 'body');
      const presEl = bodyEl && odtKids(bodyEl).find((k) => odtIs(k, 'office', 'presentation'));
      const pages = presEl ? odtKids(presEl).filter((k) => odtIs(k, 'draw', 'page')) : [];
      if (!pages.length) throw new Error('To nie jest prezentacja ODP');

      for (let i = 0; i < pages.length; i++) {
        if (onProgress) onProgress(i / pages.length);
        const pg = pages[i];
        const el = h('div', { class: 'slide', style: `width:${W}px;height:${H}px` });
        const mName = odtAttr(pg, 'draw', 'master-page-name');
        const mEl = masterEls.get(mName);
        // tło: styl strony slajdu, potem wzorca
        const pStyle = st.resolve(odtAttr(pg, 'draw', 'style-name'), 'drawing-page')['drawing-page'] || {};
        const mStyle = mEl ? (stM.resolve(odtAttr(mEl, 'draw', 'style-name'), 'drawing-page')['drawing-page'] || {}) : {};
        el.style.background = (pStyle.fill && pStyle.fill !== 'none' ? fillOf(pStyle, st, zip, fillImages) : null) || fillOf(mStyle, stM, zip, fillImages) || '#fff';
        const showMaster = pStyle['background-objects-visible'] !== 'false';
        if (mEl && showMaster) {
          for (const k of odtKids(mEl)) {
            if (odtAttr(k, 'presentation', 'class')) continue; // pola zastępcze wzorca
            await shape(k, el, convM, stM);
          }
        }
        for (const k of odtKids(pg)) {
          if (odtIs(k, 'presentation', 'notes') || odtIs(k, 'office', 'forms')) continue;
          await shape(k, el, conv, st);
        }
        const notesEl = odtKids(pg).find((k) => odtIs(k, 'presentation', 'notes'));
        let notes = '';
        if (notesEl) {
          for (const f of odtKids(notesEl)) {
            if (odtAttr(f, 'presentation', 'class') !== 'notes') continue;
            notes = Array.from(f.getElementsByTagNameNS(OdtNS.text, 'p')).map((p) => p.textContent).join('\n').trim();
          }
        }
        slides.push({ el, notes, hidden: odtAttr(pg, 'presentation', 'visibility') === 'hidden' });
      }
      await Promise.all([...conv.images, ...convM.images].map((p) => p.catch(() => {})));
      const style = h('style', { text: BASE + conv.css.join('') + convM.css.join('') });
      document.head.append(style);
      return { width: W, height: H, slides };
    },
  };
})();
