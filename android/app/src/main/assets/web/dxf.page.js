/* Skrypt strony dxf.html (wydzielony z HTML – Content-Security-Policy blokuje skrypty inline). */
  'use strict';
  /*
   * Przeglądarka rysunków CAD w formacie DXF (np. z AutoCADa): linie, polilinie z łukami,
   * okręgi, łuki, elipsy, splajny, teksty, bloki (wstawienia), wymiary, wypełnienia SOLID.
   * Warstwy z kolorami i przełączaniem widoczności, przesuwanie i powiększanie palcami.
   */
  const main = document.getElementById('main');
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  let dxf = null, light = UI.store.get('dxfLight', false);
  let strokes = [], fills = [], texts = [], layers = new Map(), hiddenLayers = new Set();
  let paths = new Map(), fillPaths = new Map();
  let view = { s: 1, tx: 0, ty: 0 }, ext = null, hits = [], hitIdx = -1, finder = null;
  const dpr = () => window.devicePixelRatio || 1;

  /* ---------- kolory ACI (AutoCAD Color Index) ---------- */
  const ACI_BASE = [0x000000, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x808080, 0xc0c0c0];
  function aci(i) {
    if (i >= 1 && i <= 9) return ACI_BASE[i];
    if (i >= 250) { const g = Math.round(51 + (i - 250) * 40.8); return (g << 16) | (g << 8) | g; }
    if (i >= 10 && i < 250) {
      const hue = Math.floor((i - 10) / 10) * 15, sub = (i - 10) % 10;
      const val = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][sub], sat = sub % 2 ? 0.5 : 1;
      const c = val, x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
      let [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
      [r, g, b] = [r, g, b].map((v) => v + (val - v) * (1 - sat));
      return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    }
    return 0xffffff;
  }
  const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
  const WHITE = 0xffffff;
  const shown = (c) => (light && (c === WHITE || c === 0xfefefe) ? '#000000' : !light && c === 0x000000 ? '#ffffff' : hex(c));

  /* ---------- odczyt pliku ---------- */
  let rawBuf = null, encUsed = 'utf-8';
  function decode(buf, forced) {
    const u8 = new Uint8Array(buf);
    const head = new TextDecoder('latin1').decode(u8.subarray(0, Math.min(u8.length, 60000)));
    if (head.startsWith('AutoCAD Binary DXF')) throw new Error('BINARY');
    const ver = (/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d+)/.exec(head) || [])[1] || '';
    const cp = (/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/.exec(head) || [])[1] || '';
    let enc = 'utf-8';
    if (ver && ver < 'AC1021') {
      const m = /ANSI_(\d+)/i.exec(cp);
      enc = m ? 'windows-' + m[1] : 'windows-1252';
    }
    if (forced) enc = forced;
    let text;
    try { text = new TextDecoder(enc, { fatal: enc === 'utf-8' }).decode(u8); } catch (e) { enc = 'windows-1250'; text = new TextDecoder(enc).decode(u8); }
    encUsed = enc;
    return { text, ver, cp };
  }

  /* ---------- spłaszczanie obiektów do linii (w układzie rysunku) ---------- */
  const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  const ap = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
  const I = [1, 0, 0, 1, 0, 0];

  function cleanText(t) {
    return String(t || '')
      .replace(/\\P/g, '\n').replace(/\\~/g, ' ')
      .replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h4) => String.fromCharCode(parseInt(h4, 16)))
      .replace(/\\[ACFHQTW][^;]*;/g, '').replace(/\\[LlOoKk]/g, '').replace(/\\S([^;]*);/g, (m, s) => s.replace(/[#^]/, '/'))
      .replace(/[{}]/g, '')
      .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%').replace(/%%[uUoO]/g, '');
  }

  function flatten() {
    strokes = []; fills = []; texts = []; layers = new Map();
    const layerTable = (dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) || {};
    for (const [name, l] of Object.entries(layerTable)) {
      layers.set(name, { name, color: l.color != null ? l.color : aci(Math.abs(l.colorIndex || 7)), count: 0, visible: l.visible !== false && !l.frozen });
      if (l.visible === false || l.frozen) hiddenLayers.add(name);
    }
    const layerOf = (e, parentLayer) => (e.layer === '0' && parentLayer ? parentLayer : e.layer || '0');
    const colorOf = (e, layer, parentColor) => {
      if (e.colorIndex === 0 && parentColor != null) return parentColor;
      if (e.color != null && e.colorIndex !== 256 && e.colorIndex !== 0) return e.color;
      const L = layers.get(layer);
      return L ? L.color : WHITE;
    };
    const touch = (layer) => {
      if (!layers.has(layer)) layers.set(layer, { name: layer, color: WHITE, count: 0, visible: true });
      layers.get(layer).count++;
    };
    const SEG = 72;

    function arcPts(M, cx, cy, r, a1, a2) {
      const out = [];
      if (a2 < a1) a2 += Math.PI * 2;
      const n = Math.max(6, Math.ceil(SEG * (a2 - a1) / (Math.PI * 2)));
      for (let k = 0; k <= n; k++) { const a = a1 + (a2 - a1) * k / n; out.push(...ap(M, cx + r * Math.cos(a), cy + r * Math.sin(a))); }
      return out;
    }

    function polyPts(M, verts, closed) {
      const out = [];
      const n = verts.length;
      const segs = closed ? n : n - 1;
      if (!n) return out;
      out.push(...ap(M, verts[0].x, verts[0].y));
      for (let i = 0; i < segs; i++) {
        const p1 = verts[i], p2 = verts[(i + 1) % n];
        const b = p1.bulge || 0;
        if (Math.abs(b) > 1e-9) {
          const dx = p2.x - p1.x, dy = p2.y - p1.y, chord = Math.hypot(dx, dy);
          if (chord > 0) {
            const theta = 4 * Math.atan(b);
            const r = chord / (2 * Math.sin(theta / 2));
            const d = (chord / 2) / Math.tan(theta / 2);
            const cx = (p1.x + p2.x) / 2 - d * dy / chord, cy = (p1.y + p2.y) / 2 + d * dx / chord;
            const a1 = Math.atan2(p1.y - cy, p1.x - cx);
            const steps = Math.max(4, Math.ceil(SEG * Math.abs(theta) / (Math.PI * 2)));
            for (let k = 1; k <= steps; k++) { const a = a1 + theta * k / steps; out.push(...ap(M, cx + Math.abs(r) * Math.cos(a), cy + Math.abs(r) * Math.sin(a))); }
            continue;
          }
        }
        out.push(...ap(M, p2.x, p2.y));
      }
      return out;
    }

    function bspline(cps, deg, knots, steps) {
      const n = cps.length;
      if (!knots || knots.length !== n + deg + 1) { knots = []; for (let i = 0; i < n + deg + 1; i++) knots.push(i < deg + 1 ? 0 : i > n - 1 ? n - deg : i - deg); }
      const lo = knots[deg], hi = knots[n];
      const out = [];
      for (let s = 0; s <= steps; s++) {
        const t = lo + (hi - lo) * s / steps;
        let k = deg;
        while (k < n - 1 && t >= knots[k + 1]) k++;
        const d = [];
        for (let j = 0; j <= deg; j++) { const p = cps[k - deg + j]; d.push([p.x, p.y]); }
        for (let r = 1; r <= deg; r++) {
          for (let j = deg; j >= r; j--) {
            const i = k - deg + j;
            const den = knots[i + deg - r + 1] - knots[i];
            const a = den ? (t - knots[i]) / den : 0;
            d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
          }
        }
        out.push(d[deg][0], d[deg][1]);
      }
      return out;
    }

    function add(e, M, parentLayer, parentColor, depth) {
      const layer = layerOf(e, parentLayer);
      if (layer === 'Defpoints') return;
      const color = colorOf(e, layer, parentColor);
      const S = (pts, closed) => { if (pts.length >= 4) { strokes.push({ layer, color, pts, closed }); touch(layer); } };
      switch (e.type) {
        case 'LINE': if (e.vertices && e.vertices.length >= 2) S([...ap(M, e.vertices[0].x, e.vertices[0].y), ...ap(M, e.vertices[1].x, e.vertices[1].y)]); break;
        case 'LWPOLYLINE': case 'POLYLINE': if (e.vertices) S(polyPts(M, e.vertices, !!e.shape), !!e.shape); break;
        case 'CIRCLE': S(arcPts(M, e.center.x, e.center.y, e.radius, 0, Math.PI * 2), true); break;
        case 'ARC': S(arcPts(M, e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle)); break;
        case 'ELLIPSE': {
          const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y, rt = e.axisRatio || 1;
          let a1 = e.startAngle || 0, a2 = e.endAngle != null ? e.endAngle : Math.PI * 2;
          if (a2 <= a1) a2 += Math.PI * 2;
          const pts = [];
          const n = Math.max(12, Math.ceil(SEG * (a2 - a1) / (Math.PI * 2)));
          for (let k = 0; k <= n; k++) {
            const t = a1 + (a2 - a1) * k / n;
            pts.push(...ap(M, e.center.x + mx * Math.cos(t) - my * rt * Math.sin(t), e.center.y + my * Math.cos(t) + mx * rt * Math.sin(t)));
          }
          S(pts);
          break;
        }
        case 'SPLINE': {
          let pts = [];
          if (e.controlPoints && e.controlPoints.length > (e.degreeOfSplineCurve || 3)) {
            const raw = bspline(e.controlPoints, e.degreeOfSplineCurve || 3, e.knotValues, Math.min(400, e.controlPoints.length * 12));
            for (let i = 0; i < raw.length; i += 2) pts.push(...ap(M, raw[i], raw[i + 1]));
          } else for (const p of (e.fitPoints || e.controlPoints || [])) pts.push(...ap(M, p.x, p.y));
          S(pts);
          break;
        }
        case 'SOLID': case 'TRACE': {
          const p = e.points || [];
          if (p.length >= 3) {
            const order = p.length === 4 ? [p[0], p[1], p[3], p[2]] : p;
            const pts = [];
            for (const q of order) pts.push(...ap(M, q.x, q.y));
            fills.push({ layer, color, pts });
            touch(layer);
          }
          break;
        }
        case '3DFACE': { const pts = []; for (const q of e.vertices || []) pts.push(...ap(M, q.x, q.y)); S(pts, true); break; }
        case 'TEXT': case 'ATTDEF': {
          if (e.type === 'ATTDEF') break;
          const useEnd = (e.halign || e.valign) && e.endPoint;
          const p = useEnd ? e.endPoint : e.startPoint;
          if (!p) break;
          const [x, y] = ap(M, p.x, p.y);
          const scale = Math.hypot(M[0], M[1]);
          const rot = (e.rotation || 0) * Math.PI / 180 + Math.atan2(M[1], M[0]);
          texts.push({ layer, color, x, y, h: (e.textHeight || 2.5) * scale, rot, text: cleanText(e.text), ha: e.halign || 0, va: e.valign || 0 });
          touch(layer);
          break;
        }
        case 'MTEXT': {
          const p = e.position;
          if (!p) break;
          const [x, y] = ap(M, p.x, p.y);
          const scale = Math.hypot(M[0], M[1]);
          let rot = e.rotation ? e.rotation * Math.PI / 180 : e.directionVector ? Math.atan2(e.directionVector.y, e.directionVector.x) : 0;
          rot += Math.atan2(M[1], M[0]);
          const at = e.attachmentPoint || 1;
          texts.push({ layer, color, x, y, h: (e.height || 2.5) * scale, rot, text: cleanText(e.text), ha: [0, 0, 1, 2, 0, 1, 2, 0, 1, 2][at], va: [0, 3, 3, 3, 2, 2, 2, 1, 1, 1][at], mtext: true });
          touch(layer);
          break;
        }
        case 'INSERT': case 'DIMENSION': {
          if (depth > 8) break;
          const blk = dxf.blocks && dxf.blocks[e.type === 'DIMENSION' ? e.block : e.name];
          if (!blk || !blk.entities) break;
          if (e.type === 'DIMENSION') { for (const c of blk.entities) add(c, M, layer, color, depth + 1); break; }
          const bp = blk.position || { x: 0, y: 0 };
          const rows = e.rowCount || 1, cols = e.columnCount || 1;
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const rad = (e.rotation || 0) * Math.PI / 180;
            const sx = e.xScale || 1, sy = e.yScale || 1;
            let T = [1, 0, 0, 1, e.position.x, e.position.y];
            T = mul(T, [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0]);
            T = mul(T, [1, 0, 0, 1, c * (e.columnSpacing || 0), r * (e.rowSpacing || 0)]);
            T = mul(T, [sx, 0, 0, sy, 0, 0]);
            T = mul(T, [1, 0, 0, 1, -bp.x, -bp.y]);
            const MM = mul(M, T);
            for (const ch of blk.entities) add(ch, MM, layer, color, depth + 1);
          }
          break;
        }
        default: break;
      }
    }
    for (const e of dxf.entities || []) add(e, I, null, null, 0);
    // zakres rysunku
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (x, y) => { if (!isFinite(x) || !isFinite(y)) return; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (const s of strokes) for (let i = 0; i < s.pts.length; i += 2) grow(s.pts[i], s.pts[i + 1]);
    for (const f of fills) for (let i = 0; i < f.pts.length; i += 2) grow(f.pts[i], f.pts[i + 1]);
    for (const t of texts) grow(t.x, t.y);
    ext = isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 100, y1: 100 };
    buildPaths();
  }

  function buildPaths() {
    paths = new Map(); fillPaths = new Map();
    for (const s of strokes) {
      if (hiddenLayers.has(s.layer)) continue;
      const k = shown(s.color);
      let p = paths.get(k);
      if (!p) { p = new Path2D(); paths.set(k, p); }
      p.moveTo(s.pts[0], s.pts[1]);
      for (let i = 2; i < s.pts.length; i += 2) p.lineTo(s.pts[i], s.pts[i + 1]);
      if (s.closed) p.closePath();
    }
    for (const f of fills) {
      if (hiddenLayers.has(f.layer)) continue;
      const k = shown(f.color);
      let p = fillPaths.get(k);
      if (!p) { p = new Path2D(); fillPaths.set(k, p); }
      p.moveTo(f.pts[0], f.pts[1]);
      for (let i = 2; i < f.pts.length; i += 2) p.lineTo(f.pts[i], f.pts[i + 1]);
      p.closePath();
    }
  }

  /* ---------- rysowanie ---------- */
  let raf = 0;
  function redraw() { if (!raf) raf = requestAnimationFrame(draw); }
  function draw() {
    raf = 0;
    const d = dpr(), W = main.clientWidth, H = main.clientHeight;
    if (cv.width !== Math.round(W * d) || cv.height !== Math.round(H * d)) { cv.width = Math.round(W * d); cv.height = Math.round(H * d); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const { s, tx, ty } = view;
    ctx.setTransform(d * s, 0, 0, -d * s, d * tx, d * ty);
    ctx.lineWidth = 1 / s;
    ctx.lineJoin = 'round';
    for (const [c, p] of fillPaths) { ctx.fillStyle = c; ctx.fill(p); }
    for (const [c, p] of paths) { ctx.strokeStyle = c; ctx.stroke(p); }
    // teksty w układzie ekranu – ostre przy każdym powiększeniu
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.textBaseline = 'alphabetic';
    for (const t of texts) {
      if (hiddenLayers.has(t.layer) || !t.text) continue;
      const px = t.h * s;
      if (px < 2.5) continue;
      const X = t.x * s + tx, Y = -t.y * s + ty;
      if (X < -2000 || X > W + 2000 || Y < -2000 || Y > H + 2000) continue;
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(-t.rot);
      ctx.font = `${px}px Roboto, Arial, sans-serif`;
      ctx.fillStyle = shown(t.color);
      const lines = t.text.split('\n');
      const lh = px * (t.mtext ? 1.45 : 1);
      const widths = lines.map((l) => ctx.measureText(l).width);
      const totalH = lh * (lines.length - 1) + px;
      let oy = 0;
      if (t.mtext) oy = t.va === 3 ? px : t.va === 2 ? px - totalH / 2 : px - totalH;
      else oy = t.va === 3 ? px : t.va === 2 ? px / 2 : t.va === 1 ? 0 : 0;
      lines.forEach((l, i) => {
        const ox = t.ha === 1 || t.ha === 4 ? -widths[i] / 2 : t.ha === 2 ? -widths[i] : 0;
        ctx.fillText(l, ox, oy + i * lh);
      });
      ctx.restore();
    }
    // wyróżnienie znalezionego tekstu
    if (hitIdx >= 0 && hits[hitIdx]) {
      const t = hits[hitIdx];
      const X = t.x * s + tx, Y = -t.y * s + ty;
      ctx.strokeStyle = '#ff9f1a';
      ctx.lineWidth = 3;
      ctx.strokeRect(X - 8, Y - t.h * s * 1.4 - 6, Math.max(40, t.text.length * t.h * s * 0.62) + 16, t.h * s * 1.8 + 12);
    }
  }

  function fitView() {
    const W = main.clientWidth, H = main.clientHeight;
    const w = Math.max(1e-9, ext.x1 - ext.x0), hh = Math.max(1e-9, ext.y1 - ext.y0);
    const s = Math.min((W - 24) / w, (H - 24) / hh);
    view = { s, tx: W / 2 - (ext.x0 + w / 2) * s, ty: H / 2 + (ext.y0 + hh / 2) * s };
    redraw();
  }
  function zoomAt(f, X, Y) {
    const s2 = Math.max(1e-12, view.s * f);
    view.tx = X - (X - view.tx) * (s2 / view.s);
    view.ty = Y - (Y - view.ty) * (s2 / view.s);
    view.s = s2;
    redraw();
  }

  /* ---------- gesty ---------- */
  let g = null, lastTap = 0;
  const pt = (t) => { const r = main.getBoundingClientRect(); return [t.clientX - r.left, t.clientY - r.top]; };
  main.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const [x, y] = pt(e.touches[0]);
      const now = Date.now();
      if (now - lastTap < 300) { zoomAt(2, x, y); lastTap = 0; } else lastTap = now;
      g = { mode: 'pan', x, y };
    } else if (e.touches.length === 2) {
      const a = pt(e.touches[0]), b = pt(e.touches[1]);
      g = { mode: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    }
  }, { passive: false });
  main.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!g) return;
    if (g.mode === 'pan' && e.touches.length === 1) {
      const [x, y] = pt(e.touches[0]);
      view.tx += x - g.x; view.ty += y - g.y; g.x = x; g.y = y;
      lastTap = 0;
      redraw();
    } else if (e.touches.length === 2) {
      const a = pt(e.touches[0]), b = pt(e.touches[1]);
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (g.mode !== 'pinch') g = { mode: 'pinch', d, m };
      view.tx += m[0] - g.m[0]; view.ty += m[1] - g.m[1];
      zoomAt(d / g.d, m[0], m[1]);
      g.d = d; g.m = m;
    }
  }, { passive: false });
  main.addEventListener('touchend', (e) => {
    if (e.touches.length === 1) { const [x, y] = pt(e.touches[0]); g = { mode: 'pan', x, y }; }
    else if (!e.touches.length) g = null;
  });
  main.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = pt(e); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, x, y); }, { passive: false });
  let mouse = null;
  main.addEventListener('mousedown', (e) => { mouse = pt(e); });
  window.addEventListener('mousemove', (e) => { if (!mouse) return; const p = pt(e); view.tx += p[0] - mouse[0]; view.ty += p[1] - mouse[1]; mouse = p; redraw(); });
  window.addEventListener('mouseup', () => { mouse = null; });
  window.addEventListener('resize', redraw);

  /* ---------- warstwy, tło, szukanie ---------- */
  function showLayers() {
    const box = h('div');
    const list = [...layers.values()].filter((l) => l.count && l.name !== 'Defpoints').sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    for (const l of list) {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !hiddenLayers.has(l.name);
      cb.onchange = () => { if (cb.checked) hiddenLayers.delete(l.name); else hiddenLayers.add(l.name); buildPaths(); redraw(); };
      box.append(h('label', { class: 'layer' }, cb, h('span', { class: 'sw', style: `background:${shown(l.color)}` }), l.name, h('span', { class: 'cnt', text: String(l.count) })));
    }
    UI.dialog({
      title: `Warstwy (${list.length})`, body: box,
      buttons: [
        { label: 'Wszystkie', action: () => { hiddenLayers.clear(); buildPaths(); redraw(); box.querySelectorAll('input').forEach((c) => { c.checked = true; }); return false; } },
        { label: 'Gotowe', primary: true },
      ],
    });
  }

  function focusText(t) {
    const W = main.clientWidth, H = main.clientHeight;
    const s = Math.max(view.s, 28 / Math.max(1e-9, t.h));
    view = { s, tx: W / 2 - t.x * s, ty: H / 2 + t.y * s };
    redraw();
  }

  UI.bar({
    actions: [
      { icon: 'toc', label: 'Warstwy', onClick: showLayers },
      { icon: 'search', label: 'Szukaj tekstu', onClick: () => {
        finder = UI.find({
          placeholder: 'Szukaj tekstu na rysunku',
          onSearch: (q) => {
            const n2 = foldText(q);
            hits = q ? texts.filter((t) => !hiddenLayers.has(t.layer) && foldText(t.text).includes(n2)) : [];
            hitIdx = hits.length ? 0 : -1;
            if (hits.length) focusText(hits[0]); else redraw();
            finder.count(hits.length ? 1 : 0, hits.length);
          },
          onNext: () => { if (!hits.length) return; hitIdx = (hitIdx + 1) % hits.length; focusText(hits[hitIdx]); finder.count(hitIdx + 1, hits.length); },
          onPrev: () => { if (!hits.length) return; hitIdx = (hitIdx - 1 + hits.length) % hits.length; focusText(hits[hitIdx]); finder.count(hitIdx + 1, hits.length); },
          onClose: () => { hits = []; hitIdx = -1; finder = null; redraw(); },
        });
      } },
    ],
    menu: () => [
      { icon: 'fit', label: 'Cały rysunek', onClick: fitView },
      { icon: 'wrap', label: 'Kodowanie znaków…', onClick: () => chooseEncoding(encUsed, (e) => { dxf = new DxfParser().parseSync(decode(rawBuf, e).text); flatten(); redraw(); }) },
      { icon: 'text', label: 'Jasne tło', checked: light, onClick: () => { light = !light; UI.store.set('dxfLight', light); document.body.classList.toggle('light', light); buildPaths(); redraw(); } },
    ],
  });

  const UNITS = { 1: 'cale', 2: 'stopy', 4: 'mm', 5: 'cm', 6: 'm', 14: 'dm' };
  UI.extraInfo = () => {
    if (!dxf) return [];
    const hd = dxf.header || {};
    const w = ext.x1 - ext.x0, hh = ext.y1 - ext.y0;
    return [['Wersja', hd.$ACADVER || '—'], ['Kodowanie', encodingLabel(encUsed)], ['Jednostki', UNITS[hd.$INSUNITS] || 'nieokreślone'], ['Warstwy', String([...layers.values()].filter((l) => l.count).length)],
      ['Obiekty', String(strokes.length + fills.length + texts.length)], ['Zakres', `${w.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} × ${hh.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}`]];
  };

  (async () => {
    UI.loading('Otwieranie rysunku…');
    document.body.classList.toggle('light', light);
    try {
      const raw = await UI.fetchFile();
      rawBuf = raw;
      UI.loading('Czytam rysunek…');
      await new Promise((r) => setTimeout(r, 20));
      const { text } = decode(raw);
      dxf = new DxfParser().parseSync(text);
      if (!dxf) throw new Error('Nie udało się odczytać pliku DXF');
      flatten();
      UI.done();
      fitView();
      const n = strokes.length + fills.length + texts.length;
      const un = UNITS[(dxf.header || {}).$INSUNITS];
      UI.setSub(`Rysunek DXF · ${n.toLocaleString('pl-PL')} ${plPlural(n, 'obiekt', 'obiekty', 'obiektów')}${un ? ' · ' + un : ''}`);
      if (!n) UI.toast('Rysunek nie zawiera obsługiwanych obiektów');
    } catch (e) {
      console.error(e);
      if (String(e.message) === 'BINARY') UI.fail('Binarny DXF', 'Ten plik DXF jest zapisany w wersji binarnej. Zapisz go w programie CAD jako DXF tekstowy (ASCII).');
      else UI.fail('Nie udało się otworzyć rysunku', String(e && e.message || e));
    }
  })();
