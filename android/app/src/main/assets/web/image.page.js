/* Skrypt strony image.html (wydzielony z HTML – Content-Security-Policy blokuje skrypty inline). */
  'use strict';
  const main = document.getElementById('main');
  const box = document.getElementById('box');
  const img = document.getElementById('img');
  let fitZ = 1;
  const zp = new ZoomPane(main, box, { min: 0.05, max: 12, fit: () => fitZ });

  UI.bar({ menu: [] });
  UI.loading('Otwieranie obrazu…');

  function layout() {
    const w = img.naturalWidth, hh = img.naturalHeight;
    if (!w) return;
    img.style.width = w + 'px';
    img.style.height = hh + 'px';
    box.style.width = w + 'px';
    box.style.height = hh + 'px';
    fitZ = Math.min(main.clientWidth / w, main.clientHeight / hh, 1);
    zp.setZoom(fitZ, 0, 0);
    // wyśrodkowanie, gdy obraz jest mniejszy od ekranu
    const padX = Math.max(0, (main.clientWidth - w * fitZ) / 2 / fitZ);
    const padY = Math.max(0, (main.clientHeight - hh * fitZ) / 2 / fitZ);
    box.style.padding = `${padY}px ${padX}px`;
  }

  img.onload = () => {
    UI.done();
    layout();
    UI.setSub(`${img.naturalWidth} × ${img.naturalHeight} px`);
  };
  img.onerror = () => UI.fail('Nie udało się wyświetlić obrazu', 'Format obrazu nie jest obsługiwany albo plik jest uszkodzony.');
  window.addEventListener('resize', layout);
  UI.extraInfo = () => (img.naturalWidth ? [['Wymiary', `${img.naturalWidth} × ${img.naturalHeight} px`]] : []);
  img.src = FILE.src;
