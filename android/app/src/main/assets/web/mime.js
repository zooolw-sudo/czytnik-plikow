/*
 * Parser wiadomości e-mail (MIME, RFC 5322/2045/2047/2231): nagłówki z kodowaniem
 * =?…?=, części multipart, base64 i quoted-printable, polskie strony kodowe.
 * Używany dla plików .eml oraz archiwów stron .mht/.mhtml.
 */
'use strict';

const Mime = (() => {
  const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
  const bytesOf = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; };

  function decodeBytes(u8, charset) {
    let cs = (charset || '').toLowerCase().replace(/^["']|["']$/g, '');
    if (cs === 'cp1250') cs = 'windows-1250';
    if (cs === 'latin2') cs = 'iso-8859-2';
    if (!cs || cs === 'us-ascii' || cs === 'ascii') cs = 'utf-8';
    try {
      return new TextDecoder(cs, { fatal: cs === 'utf-8' }).decode(u8);
    } catch (e) {
      return decodeText(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)).text;
    }
  }

  function qp(str, header) {
    if (header) str = str.replace(/_/g, ' ');
    str = str.replace(/=\r?\n/g, '');
    const out = [];
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(str.substr(i + 1, 2))) { out.push(parseInt(str.substr(i + 1, 2), 16)); i += 2; }
      else out.push(str.charCodeAt(i) & 0xff);
    }
    return new Uint8Array(out);
  }

  function b64(str) {
    let c = str.replace(/[^A-Za-z0-9+/]/g, '');
    if (c.length % 4 === 1) c = c.slice(0, -1);
    while (c.length % 4) c += '=';
    try { return bytesOf(atob(c)); } catch (e) { return new Uint8Array(0); }
  }

  /** Nagłówek z fragmentami =?charset?B/Q?…?= (sąsiednie fragmenty sklejamy). */
  function words(s) {
    if (/[\x80-\xff]/.test(s)) { try { s = new TextDecoder('utf-8', { fatal: true }).decode(bytesOf(s)); } catch (e) { s = decodeBytes(bytesOf(s), 'windows-1250'); } }
    return s.replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1')
      .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([BbQq])\?([^?]*)\?=/g, (m, cs, enc, txt) => decodeBytes(enc.toUpperCase() === 'B' ? b64(txt) : qp(txt, true), cs));
  }

  function parseHeaders(text) {
    const map = new Map();
    const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ').split('\n');
    for (const l of lines) {
      const i = l.indexOf(':');
      if (i <= 0) continue;
      const k = l.slice(0, i).trim().toLowerCase();
      const v = l.slice(i + 1).trim();
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(v);
    }
    return map;
  }

  /** „typ/podtyp; nazwa=wartość; …” z obsługą cudzysłowów i RFC 2231 (filename*=utf-8''…). */
  function parseParams(v) {
    const parts = [];
    let cur = '', q = false;
    for (const ch of v || '') {
      if (ch === '"') q = !q;
      if (ch === ';' && !q) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    const value = parts.shift().trim().toLowerCase();
    const params = {}, ext = {};
    for (const p of parts) {
      const i = p.indexOf('=');
      if (i < 0) continue;
      const k = p.slice(0, i).trim().toLowerCase();
      let val = p.slice(i + 1).trim();
      if (val.startsWith('"')) val = val.slice(1, -1).replace(/\\(.)/g, '$1');
      const m = /^(.+?)\*(\d+)?(\*)?$/.exec(k);
      if (m) {
        (ext[m[1]] = ext[m[1]] || []).push({ n: Number(m[2] || 0), enc: !!m[3] || (!m[2] && k.endsWith('*')), val });
      } else params[k] = words(val);
    }
    for (const [k, list] of Object.entries(ext)) {
      list.sort((a, b) => a.n - b.n);
      let cs = 'utf-8';
      const bytes = [];
      list.forEach((x, idx) => {
        let val = x.val;
        if (x.enc && idx === 0 && /^[^']*'[^']*'/.test(val)) { cs = val.split("'")[0] || 'utf-8'; val = val.replace(/^[^']*'[^']*'/, ''); }
        if (x.enc) val.replace(/%([0-9A-Fa-f]{2})|([^%])/g, (mm, hex, ch) => { bytes.push(hex ? parseInt(hex, 16) : ch.charCodeAt(0) & 0xff); return ''; });
        else for (const ch of val) bytes.push(ch.charCodeAt(0) & 0xff);
      });
      params[k] = decodeBytes(new Uint8Array(bytes), cs);
    }
    return { value, params };
  }

  function indexOfSeq(u8, seq, from = 0) {
    outer: for (let i = from; i <= u8.length - seq.length; i++) {
      for (let j = 0; j < seq.length; j++) if (u8[i + j] !== seq[j]) continue outer;
      return i;
    }
    return -1;
  }

  function parsePart(u8, depth = 0) {
    let split = indexOfSeq(u8, [13, 10, 13, 10]), skip = 4;
    const lf = indexOfSeq(u8, [10, 10]);
    if (split < 0 || (lf >= 0 && lf < split)) { split = lf; skip = 2; }
    if (split < 0) { split = u8.length; skip = 0; }
    const headers = parseHeaders(latin1(u8.subarray(0, split)));
    const raw = u8.subarray(Math.min(u8.length, split + skip));
    const ct = parseParams((headers.get('content-type') || ['text/plain'])[0]);
    const cd = parseParams((headers.get('content-disposition') || [''])[0]);
    const part = {
      headers, type: ct.value || 'text/plain', params: ct.params,
      disposition: cd.value, filename: cd.params.filename || ct.params.name || '',
      id: ((headers.get('content-id') || [''])[0]).replace(/^<|>$/g, '').trim(),
      location: ((headers.get('content-location') || [''])[0]).trim(),
      parts: [], body: null,
    };
    if (part.type.startsWith('multipart/') && part.params.boundary && depth < 20) {
      const b = bytesOf('--' + part.params.boundary);
      let pos = indexOfSeq(raw, b);
      while (pos >= 0) {
        let start = pos + b.length;
        if (raw[start] === 45 && raw[start + 1] === 45) break; // --boundary-- koniec
        while (raw[start] === 32 || raw[start] === 9) start++;
        if (raw[start] === 13) start++;
        if (raw[start] === 10) start++;
        let next = indexOfSeq(raw, b, start);
        const end = next < 0 ? raw.length : next;
        let e2 = end;
        if (raw[e2 - 1] === 10) e2--;
        if (raw[e2 - 1] === 13) e2--;
        part.parts.push(parsePart(raw.subarray(start, e2), depth + 1));
        pos = next;
      }
    } else {
      const cte = ((headers.get('content-transfer-encoding') || [''])[0]).toLowerCase().trim();
      if (cte === 'base64') part.body = b64(latin1(raw));
      else if (cte === 'quoted-printable') part.body = qp(latin1(raw));
      else part.body = raw;
    }
    return part;
  }

  function text(part) {
    return decodeBytes(part.body || new Uint8Array(0), part.params.charset);
  }

  /** Wybiera treść do pokazania, zasoby (obrazy cid:) i załączniki. */
  function analyse(root) {
    let html = null, plain = null;
    const resources = [], attachments = [];
    const isAttachment = (p) => p.disposition === 'attachment' || (p.filename && !p.type.startsWith('text/') && p.disposition !== 'inline');
    const walk = (p, inAlt) => {
      if (p.parts.length) {
        const alt = p.type === 'multipart/alternative';
        for (const c of p.parts) walk(c, alt || inAlt);
        return;
      }
      if (p.type === 'message/rfc822') { attachments.push({ name: p.filename || 'wiadomosc.eml', part: p }); return; }
      if (isAttachment(p)) { attachments.push({ name: p.filename || 'zalacznik', part: p }); return; }
      if (p.type === 'text/html' && !html) { html = p; return; }
      if (p.type === 'text/plain' && !plain) { plain = p; return; }
      if (p.type.startsWith('image/') || p.id || p.location) { resources.push(p); return; }
      if (p.body && p.body.length) attachments.push({ name: p.filename || 'zalacznik', part: p });
    };
    walk(root, false);
    // obrazy wstawione w treść, do których nie ma odwołania – też jako załączniki
    return { html, plain, resources, attachments };
  }

  function addressList(v) {
    return (v || []).map(words).join(', ');
  }

  return { parse: parsePart, analyse, text, words, addressList, decodeBytes };
})();
