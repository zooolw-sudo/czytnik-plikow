/*
 * Przeglądarka PDF oparta na pdf.js (Mozilla): przewijanie stron, powiększanie
 * dwoma palcami, szukanie w tekście, spis treści, przejście do strony, hasła.
 */
import * as pdfjsLib from './lib/pdfjs/pdf.min.mjs';

globalThis.pdfjsLib = pdfjsLib;
const abs = (p) => new URL(p, location.href).href;

const container = document.getElementById('viewerContainer');
const viewerEl = document.getElementById('viewer');
const badge = document.getElementById('pageBadge');

let viewer, eventBus, linkService, pdfDoc, outline = null, finder = null;
let fitMode = 'width';   // 'width' | 'page' | null (własne powiększenie)

UI.bar({
  actions: [{ icon: 'search', label: 'Szukaj', onClick: () => openFind() }],
  menu: () => {
    const items = [{ icon: 'goto', label: 'Przejdź do strony…', onClick: gotoPage }];
    if (outline && outline.length) items.push({ icon: 'toc', label: 'Spis treści', onClick: showOutline });
    items.push(
      { icon: 'fit', label: 'Dopasuj do szerokości', checked: fitMode === 'width', onClick: () => setFit('width') },
      { icon: 'page', label: 'Cała strona', checked: fitMode === 'page', onClick: () => setFit('page') },
      { icon: 'wrap', label: 'Obróć', onClick: () => { viewer.pagesRotation = (viewer.pagesRotation + 90) % 360; if (fitMode) setFit(fitMode); } });
    return items;
  },
});
UI.loading('Otwieranie PDF…');

async function makeWorker() {
  // Worker uruchamiany z kopii w pamięci (blob) – działa niezależnie od tego,
  // czy WebView przepuszcza żądania workerów przez aplikację.
  try {
    const code = await (await fetch('lib/pdfjs/pdf.worker.min.mjs')).text();
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module' });
  } catch (e) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = abs('lib/pdfjs/pdf.worker.min.mjs');
  }
}

function fitScale(mode) {
  const pv = viewer.getPageView(Math.max(0, viewer.currentPageNumber - 1));
  if (!pv) return 1;
  const w = pv.width / pv.scale, hgt = pv.height / pv.scale;
  const sw = (container.clientWidth - 12) / w;
  if (mode === 'page') return Math.min(sw, (container.clientHeight - 16) / hgt);
  return sw;
}

function setFit(mode) {
  fitMode = mode;
  viewer.currentScale = fitScale(mode);
}

function showBadge() {
  badge.textContent = `${viewer.currentPageNumber} / ${pdfDoc.numPages}`;
  badge.classList.add('show');
  clearTimeout(showBadge.t);
  showBadge.t = setTimeout(() => badge.classList.remove('show'), 1200);
}

async function gotoPage() {
  const v = await UI.prompt({
    title: 'Przejdź do strony',
    label: `Numer strony (1–${pdfDoc.numPages})`,
    type: 'number',
    value: String(viewer.currentPageNumber),
    okLabel: 'Przejdź',
    validate: (s) => {
      const n = Number(s);
      return Number.isInteger(n) && n >= 1 && n <= pdfDoc.numPages ? null : `Wpisz liczbę od 1 do ${pdfDoc.numPages}`;
    },
  });
  if (v != null) viewer.currentPageNumber = Number(v);
}

function showOutline() {
  const list = h('div', { class: 'list' });
  let d;
  const add = (items, lvl) => {
    for (const it of items) {
      list.append(h('button', {
        class: 'toc-item', style: `--lvl:${lvl}`, text: it.title || '(bez tytułu)',
        onclick: () => {
          d.close();
          if (it.dest) linkService.goToDestination(it.dest);
          else if (it.url && Bridge) Bridge.openUrl(it.url);
        },
      }));
      if (it.items && it.items.length && lvl < 4) add(it.items, lvl + 1);
    }
  };
  add(outline, 0);
  d = UI.dialog({ title: 'Spis treści', body: list, buttons: [{ label: 'Zamknij' }] });
}

function openFind() {
  if (!pdfDoc) return;
  const send = (query, type, findPrevious = false) => eventBus.dispatch('find', {
    source: null, type, query, caseSensitive: false, entireWord: false,
    highlightAll: true, findPrevious, matchDiacritics: false,
  });
  let q = '';
  finder = UI.find({
    placeholder: 'Szukaj w PDF',
    onSearch: (v) => { q = v; if (v) send(v, ''); else { eventBus.dispatch('findbarclose', { source: null }); finder.count(0, 0); } },
    onNext: () => q && send(q, 'again', false),
    onPrev: () => q && send(q, 'again', true),
    onClose: () => { eventBus.dispatch('findbarclose', { source: null }); finder = null; },
  });
}

/* ---------- powiększanie dwoma palcami i podwójnym stuknięciem ---------- */
function setupGestures() {
  let pinch = null, tap = null, lastTap = null;
  const mid = (a, b) => [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2];
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;

  container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      pinch = { d0: dist(a, b), s0: viewer.currentScale, m: mid(a, b) };
      tap = lastTap = null;
    } else if (e.touches.length === 1) {
      tap = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }
  }, { passive: false });

  container.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) {
      if (tap && e.touches.length === 1 && Math.hypot(e.touches[0].clientX - tap.x, e.touches[0].clientY - tap.y) > 12) tap = null;
      return;
    }
    e.preventDefault();
    const [a, b] = e.touches;
    const m = mid(a, b);
    const target = Math.min(10, Math.max(0.2, pinch.s0 * dist(a, b) / pinch.d0));
    const factor = target / viewer.currentScale;
    const pan = [pinch.m[0] - m[0], pinch.m[1] - m[1]];
    pinch.m = m;
    if (Math.abs(factor - 1) > 0.01) {
      viewer.updateScale({ drawingDelay: 350, scaleFactor: factor, origin: m, pan });
      fitMode = null;
    } else if (pan[0] || pan[1]) {
      viewer.updateScale({ drawingDelay: 350, scaleFactor: 1, pan });
    }
  }, { passive: false });

  const end = (e) => {
    if (pinch) {
      if (e.touches.length < 2) pinch = null;
      return;
    }
    if (tap && e.touches.length === 0 && Date.now() - tap.t < 250) {
      const now = Date.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 40) {
        const fit = fitScale('width');
        const target = viewer.currentScale > fit * 1.3 ? fit : fit * 2.5;
        viewer.updateScale({ drawingDelay: -1, scaleFactor: target / viewer.currentScale, origin: [tap.x, tap.y] });
        fitMode = target === fit ? 'width' : null;
        lastTap = null;
      } else {
        lastTap = { x: tap.x, y: tap.y, t: now };
      }
    }
    tap = null;
  };
  container.addEventListener('touchend', end);
  container.addEventListener('touchcancel', end);

  // Ctrl + kółko myszy (przydatne przy testach na komputerze)
  container.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    viewer.updateScale({ drawingDelay: 200, scaleFactor: e.deltaY < 0 ? 1.1 : 1 / 1.1, origin: [e.clientX, e.clientY] });
    fitMode = null;
  }, { passive: false });
}

async function main() {
  const { PDFViewer, EventBus, PDFLinkService, PDFFindController, LinkTarget } = await import('./lib/pdfjs/pdf_viewer.mjs');
  await makeWorker();

  eventBus = new EventBus();
  linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
  const findController = new PDFFindController({ eventBus, linkService });
  viewer = new PDFViewer({
    container, viewer: viewerEl, eventBus, linkService, findController,
    textLayerMode: 1,
    annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS,
    maxCanvasPixels: 8 * 1024 * 1024,
  });
  linkService.setViewer(viewer);

  eventBus.on('pagesinit', () => setFit('width'));
  eventBus.on('pagechanging', () => {
    UI.setSub(`Strona ${viewer.currentPageNumber} z ${pdfDoc.numPages}`, gotoPage);
    showBadge();
  });
  const onCount = ({ matchesCount, state }) => {
    if (!finder) return;
    if (state === 1) finder.count(0, 0); // nie znaleziono
    else if (matchesCount) finder.count(matchesCount.current, matchesCount.total);
  };
  eventBus.on('updatefindmatchescount', onCount);
  eventBus.on('updatefindcontrolstate', onCount);

  window.addEventListener('resize', () => { if (fitMode && pdfDoc) setFit(fitMode); });
  setupGestures();

  const task = pdfjsLib.getDocument({
    url: FILE.src,
    cMapUrl: abs('lib/pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: abs('lib/pdfjs/standard_fonts/'),
    wasmUrl: abs('lib/pdfjs/wasm/'),
    iccUrl: abs('lib/pdfjs/iccs/'),
    useWorkerFetch: false,
    isEvalSupported: false,
    enableXfa: true,
    disableRange: true,
  });
  task.onProgress = ({ loaded, total }) => { if (total) UI.progress(loaded / total); };
  task.onPassword = async (update, reason) => {
    const pass = await UI.prompt({
      title: reason === 2 ? 'Nieprawidłowe hasło' : 'Plik chroniony hasłem',
      label: reason === 2 ? 'Spróbuj ponownie:' : 'Ten PDF wymaga hasła do otwarcia.',
      type: 'password', okLabel: 'Otwórz',
    });
    if (pass == null) { task.destroy(); UI.fail('Plik chroniony hasłem', 'Bez hasła nie da się otworzyć tego dokumentu.', { icon: 'lock' }); }
    else update(pass);
  };

  try {
    pdfDoc = await task.promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') return;
    console.error(e);
    UI.fail('Nie udało się otworzyć PDF', e && e.name === 'InvalidPDFException'
      ? 'Plik jest uszkodzony albo to nie jest prawidłowy PDF.' : String(e && e.message || e));
    return;
  }
  viewer.setDocument(pdfDoc);
  linkService.setDocument(pdfDoc, null);
  UI.done();
  UI.setSub(`Strona 1 z ${pdfDoc.numPages}`, gotoPage);

  pdfDoc.getOutline().then((o) => { outline = o; }).catch(() => {});
  let meta = null;
  pdfDoc.getMetadata().then((m) => { meta = m; }).catch(() => {});
  UI.extraInfo = () => {
    const rows = [['Strony', String(pdfDoc.numPages)]];
    const i = meta && meta.info || {};
    if (i.Title) rows.push(['Tytuł', i.Title]);
    if (i.Author) rows.push(['Autor', i.Author]);
    if (i.Creator || i.Producer) rows.push(['Utworzony w', [i.Creator, i.Producer].filter(Boolean).join(' / ')]);
    if (i.PDFFormatVersion) rows.push(['Wersja PDF', i.PDFFormatVersion]);
    return rows;
  };
}

main().catch((e) => {
  console.error(e);
  UI.fail('Błąd przeglądarki PDF', String(e && e.message || e));
});
