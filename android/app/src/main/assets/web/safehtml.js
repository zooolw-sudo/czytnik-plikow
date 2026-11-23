/*
 * Bezpieczne wyświetlanie obcego HTML (e-maile, strony, Markdown):
 * DOMPurify usuwa skrypty i niebezpieczne elementy, treść trafia do osobnego
 * „shadow DOM”, więc jej style nie psują wyglądu aplikacji. Obrazy z internetu są
 * pomijane (aplikacja działa bez internetu), linki otwierają się w przeglądarce.
 */
'use strict';

const SafeHtml = {
  /** Czyści HTML; resources: Map adres (cid:…, nazwa pliku) -> adres blob z treścią. */
  sanitize(html, resources) {
    const frag = DOMPurify.sanitize(html, {
      RETURN_DOM_FRAGMENT: true,
      FORCE_BODY: true,
      ADD_TAGS: ['style'],
      FORBID_TAGS: ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'base', 'meta', 'link', 'audio', 'video', 'source'],
      FORBID_ATTR: ['srcset', 'ping', 'action', 'formaction'],
      ALLOW_DATA_ATTR: false,
    });
    let remote = 0;
    for (const img of frag.querySelectorAll('img')) {
      const src = (img.getAttribute('src') || '').trim();
      const key = src.replace(/^cid:/i, '').replace(/^<|>$/g, '');
      if (resources && (resources.has(src) || resources.has('cid:' + key) || resources.has(key))) {
        img.setAttribute('src', resources.get(src) || resources.get('cid:' + key) || resources.get(key));
      } else if (/^(https?:)?\/\//i.test(src)) {
        img.removeAttribute('src');
        img.style.display = 'none';
        remote++;
      } else if (!/^(data:image\/|blob:)/i.test(src)) {
        img.removeAttribute('src');
      }
    }
    // style z adresami internetowymi (tła) – usuwamy odwołania
    // selektory body/html z treści działają na jej kontenerze w shadow DOM
    for (const st of frag.querySelectorAll('style')) {
      st.textContent = st.textContent.replace(/@import[^;]+;/g, '').replace(/url\(\s*['"]?https?:[^)]*\)/gi, 'none')
        .replace(/(?<![\w.#-])(html|body)(?![\w-])/gi, '.content');
    }
    for (const el of frag.querySelectorAll('[style*="url("]')) el.setAttribute('style', el.getAttribute('style').replace(/url\(\s*['"]?https?:[^)]*\)/gi, 'none'));
    return { frag, remote };
  },

  BASE_CSS: `
    :host { display: block; color: #1c2333; background: #fff; font: 15px/1.5 Roboto, system-ui, sans-serif; overflow-wrap: anywhere; }
    .content { padding: 14px; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; }
    pre { white-space: pre-wrap; }
    a { color: #2563eb; }
    mark.hit { background: #ffe066; color: inherit; border-radius: 2px; }
    mark.hit.cur { background: #ff9f1a; }
  `,

  /** Wstawia oczyszczony HTML do elementu-gospodarza (shadow DOM). Zwraca korzeń do szukania. */
  mount(host, frag, extraCss = '') {
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.innerHTML = '';
    const st = document.createElement('style');
    st.textContent = SafeHtml.BASE_CSS + extraCss;
    const content = document.createElement('div');
    content.className = 'content';
    content.append(frag);
    root.append(st, content);
    root.addEventListener('click', (e) => {
      const a = e.composedPath().find((n) => n.tagName === 'A' && n.getAttribute && n.getAttribute('href'));
      if (!a) return;
      const href = a.getAttribute('href').trim();
      e.preventDefault();
      if (href.startsWith('#')) {
        const id = decodeURIComponent(href.slice(1));
        const t = root.getElementById(id) || root.querySelector(`[name="${CSS.escape(id)}"]`);
        if (t) t.scrollIntoView({ block: 'start' });
      } else if (/^(https?:|mailto:|tel:)/i.test(href)) {
        UI.dialog({
          title: 'Otworzyć link?',
          body: href.length > 300 ? href.slice(0, 300) + '…' : href,
          buttons: [{ label: 'Anuluj' }, { label: 'Otwórz', primary: true, action: () => (Bridge ? Bridge.openUrl(href) : window.open(href, '_blank')) }],
        });
      }
    });
    return root;
  },
};

/** Przekazuje plik (np. załącznik) do aplikacji, która otwiera go jak każdy inny. */
UI.openBytes = function (name, bytes, source) {
  if (!Bridge || !Bridge.childBegin) { UI.toast('Otwieranie załączników działa w aplikacji'); return; }
  UI.loading(`Otwieranie „${name}”…`);
  setTimeout(() => {
    const b64 = (u8) => {
      let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(s);
    };
    Bridge.childBegin(name, source || 'Załącznik z ' + FILE.name);
    const CH = 3 * 256 * 1024;
    for (let i = 0; i < bytes.length; i += CH) Bridge.childChunk(b64(bytes.subarray(i, i + CH)));
    Bridge.childEnd();
  }, 40);
};
