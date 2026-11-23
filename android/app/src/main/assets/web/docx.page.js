/* Skrypt strony docx.html (wydzielony z HTML – Content-Security-Policy blokuje skrypty inline). */
  DocView.start({
    label: 'Dokument Word',
    async render(data, el, mode) {
      await docx.renderAsync(data, el, null, {
        className: 'docx',
        inWrapper: true,
        ignoreWidth: mode === 'read',
        ignoreHeight: mode === 'read',
        breakPages: mode !== 'read',
        ignoreLastRenderedPageBreak: mode === 'read',
        experimental: true,
        renderHeaders: mode !== 'read',
        renderFooters: mode !== 'read',
        renderFootnotes: true,
        renderEndnotes: true,
        renderChanges: false,
        renderComments: false,
        useBase64URL: false,
      });
      // punktory z czcionek Symbol/Wingdings (prywatne kody Unicode) zamieniamy na zwykłe znaki
      const PUA = { '\uf0b7': '•', '\uf0a7': '▪', '\uf0d8': '➢', '\uf0fc': '✓', '\uf076': '❖', '\uf06e': '■', '\uf071': '❑', '\uf0a8': '□' };
      for (const s of el.querySelectorAll('style')) {
        if (/[\uf000-\uf0ff]/.test(s.textContent)) s.textContent = s.textContent.replace(/[\uf000-\uf0ff]/g, (c) => PUA[c] || '•');
      }
      return el.querySelectorAll('section.docx').length;
    },
  });
