/* Skrypt strony eml.html (wydzielony z HTML – Content-Security-Policy blokuje skrypty inline). */
  'use strict';
  const main = document.getElementById('main');
  const box = document.getElementById('box');
  const isWebArchive = /\.(mht|mhtml)$/i.test(FILE.name);
  const COLORS = { pdf: '#e0483b', doc: '#2b67d1', xls: '#1e9a57', img: '#8b5cf6', zip: '#a0702a', other: '#8a93a3' };
  const kindOf = (n) => {
    const x = (n.split('.').pop() || '').toLowerCase();
    if (x === 'pdf') return 'pdf';
    if (/^(docx?|odt|rtf|txt)$/.test(x)) return 'doc';
    if (/^(xlsx?|xlsm|ods|csv)$/.test(x)) return 'xls';
    if (/^(jpe?g|png|gif|webp|heic|bmp)$/.test(x)) return 'img';
    if (/^(zip|rar|7z)$/.test(x)) return 'zip';
    return 'other';
  };
  let search = null, finder = null, showHtml = true, msg = null, info = null;
  const zp = new ZoomPane(main, box, { min: 0.5, max: 4, fit: () => 1 });

  UI.bar({
    actions: [{ icon: 'search', label: 'Szukaj', onClick: () => {
      finder = UI.find({
        placeholder: 'Szukaj w wiadomości',
        onSearch: (q) => { const n = search.run(q); finder.count(n ? 1 : 0, n); },
        onNext: () => { search.next(); finder.count(search.cur + 1, search.hits.length); },
        onPrev: () => { search.prev(); finder.count(search.cur + 1, search.hits.length); },
        onClose: () => { search.clear(); finder = null; },
      });
    } }],
    menu: () => (info && info.html && info.plain ? [
      { icon: 'text', label: 'Treść jako zwykły tekst', checked: !showHtml, onClick: () => { showHtml = !showHtml; render(); } },
    ] : []),
  });

  function addr(v) {
    const s = Mime.words(v || '');
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s);
    return m ? { name: m[1].trim() || m[2], email: m[2] } : { name: s, email: '' };
  }

  function linkify(text, el) {
    const re = /\b(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      el.append(text.slice(last, m.index), h('a', { href: m[1], text: m[1] }));
      last = m.index + m[1].length;
    }
    el.append(text.slice(last));
  }

  function render() {
    if (finder) finder.close();
    box.innerHTML = '';
    const H = msg.headers;
    const get = (k) => (H.get(k) || [])[0] || '';
    const subject = Mime.words(get('subject')) || (isWebArchive ? FILE.name : '(bez tematu)');
    const head = h('section', { class: 'head' }, h('h1', { text: subject }));
    if (!isWebArchive || get('from')) {
      const f = addr(get('from'));
      head.append(h('div', { class: 'from' },
        h('div', { class: 'avatar', text: (f.name || '?').replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?' }),
        h('div', { class: 'who' }, h('div', { class: 'nm', text: f.name || '(nieznany nadawca)' }), f.email ? h('div', { class: 'em', text: f.email }) : null)));
    }
    const rows = [];
    if (get('to')) rows.push(['Do', Mime.addressList(H.get('to'))]);
    if (get('cc')) rows.push(['DW', Mime.addressList(H.get('cc'))]);
    if (get('reply-to')) rows.push(['Odpowiedz', Mime.addressList(H.get('reply-to'))]);
    if (get('date')) {
      const d = new Date(get('date'));
      rows.push(['Data', isNaN(d) ? get('date') : d.toLocaleString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })]);
    }
    if (isWebArchive && get('snapshot-content-location')) rows.push(['Strona', get('snapshot-content-location')]);
    if (rows.length) {
      const dl = h('dl', { class: 'kv' });
      for (const [k, v] of rows) dl.append(h('dt', { text: k }), h('dd', { text: v }));
      head.append(h('div', { class: 'meta' }, dl));
    }
    box.append(head);

    if (info.attachments.length) {
      const atts = h('div', { class: 'atts' });
      for (const a of info.attachments) {
        const name = a.part.type === 'message/rfc822' && !/\.eml$/i.test(a.name) ? a.name + '.eml' : a.name;
        const k = kindOf(name);
        const size = a.part.body ? a.part.body.length : 0;
        atts.append(h('button', { class: 'att', onclick: () => UI.openBytes(name, a.part.body || new Uint8Array(0), 'Załącznik z ' + FILE.name) },
          h('span', { class: 'ico', style: `background:${COLORS[k]}`, text: ((name.split('.').pop() || '?').toUpperCase()).slice(0, 4) }),
          h('span', null, h('div', { class: 'nm', text: name }), h('div', { class: 'sz', text: UI.formatSize(size) }))));
      }
      box.append(atts);
    }

    const body = h('div', { class: 'bodybox' });
    box.append(body);
    if (info.html && showHtml) {
      const res = new Map();
      for (const r of info.resources) {
        const url = URL.createObjectURL(new Blob([r.body || new Uint8Array(0)], { type: r.type }));
        if (r.id) { res.set('cid:' + r.id, url); res.set(r.id, url); }
        if (r.location) res.set(r.location, url);
        if (r.filename) res.set(r.filename, url);
      }
      const { frag, remote } = SafeHtml.sanitize(Mime.text(info.html), res);
      const host = h('div');
      body.append(host);
      const root = SafeHtml.mount(host, frag);
      search = new DomSearch(root, main);
      if (remote) box.insertBefore(h('div', { class: 'note', text: `Pominięto ${remote} ${plPlural(remote, 'obraz', 'obrazy', 'obrazów')} z internetu – czytnik działa bez dostępu do sieci.` }), body);
    } else {
      const pre = h('pre', { class: 'plain' });
      linkify(info.plain ? Mime.text(info.plain) : (info.html ? DOMPurify.sanitize(Mime.text(info.html), { RETURN_DOM: true }).textContent : '(wiadomość bez treści)'), pre);
      body.append(pre);
      search = new DomSearch(pre, main);
      pre.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (!a) return;
        e.preventDefault();
        if (Bridge) Bridge.openUrl(a.href); else window.open(a.href, '_blank');
      });
    }
    const n = info.attachments.length;
    UI.setSub((isWebArchive ? 'Archiwum strony' : 'Wiadomość e-mail') + (n ? ` · ${n} ${plPlural(n, 'załącznik', 'załączniki', 'załączników')}` : ''));
  }

  UI.extraInfo = () => {
    if (!msg) return [];
    const r = [];
    const ua = (msg.headers.get('x-mailer') || msg.headers.get('user-agent') || [])[0];
    if (ua) r.push(['Program', ua]);
    r.push(['Załączniki', String(info.attachments.length)]);
    return r;
  };

  (async () => {
    UI.loading('Otwieranie wiadomości…');
    try {
      const buf = new Uint8Array(await UI.fetchFile());
      msg = Mime.parse(buf);
      info = Mime.analyse(msg);
      render();
      UI.done();
    } catch (e) {
      console.error(e);
      UI.fail('Nie udało się otworzyć wiadomości', String(e && e.message || e));
    }
  })();
