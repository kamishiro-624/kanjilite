/* Fills in pitch accent diagrams. renderInfo() writes placeholders like
   <div class="pitch" data-pitch='[{"w":"水","r":"みず"}]'></div>; this notices them whenever they appear
   (detail dialog, lessons, reviews) and replaces each with diagrams, once the accent data is ready. */
(function () {
  'use strict';
  if (!window.Pitch) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fill(el) {
    let words;
    try { words = JSON.parse(el.dataset.pitch); } catch (e) { return; }
    delete el.dataset.pitch;
    el.classList.add('pitch-loading');
    el.textContent = 'Loading pitch accent…';
    Pitch.load().then(() => {
      if (!el.isConnected) return;
      const rows = [];
      words.forEach((x) => {
        Pitch.find(x.w, x.r).forEach((a) => {
          const n = Pitch.moras(x.r).length;
          const svg = Pitch.svg(x.r, a);
          if (!svg) return;
          rows.push(`<div class="pitch-row"><span class="pitch-word">${esc(x.show ? x.w : '')}</span>${svg}<span class="pitch-kind muted">${esc(Pitch.label(n, a))}</span></div>`);
        });
      });
      el.classList.remove('pitch-loading');
      if (rows.length) el.innerHTML = rows.join('');
      else { el.closest('section') ? el.closest('section').remove() : el.remove(); }
    }).catch(() => {
      el.classList.remove('pitch-loading');
      el.innerHTML = '<span class="muted">Pitch accent data could not be loaded (it needs a connection the first time).</span>';
    });
  }

  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches && node.matches('[data-pitch]')) fill(node);
    node.querySelectorAll && node.querySelectorAll('[data-pitch]').forEach(fill);
  }
  new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
})();
