/* The Search screen: type a meaning, a reading (kana or romaji) or the kanji itself and see every matching item.
   Tapping an item opens the usual detail view (app.js handles anything with data-subject), which links out to
   WaniKani and Jisho. */
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PAGE = 60; // tiles shown per group before "Show more"
  const FIELDS = [
    { value: 'all', label: 'Meaning, reading or kanji' }, { value: 'meaning', label: 'Meaning only' },
    { value: 'reading', label: 'Reading only' }, { value: 'character', label: 'Kanji or word only' },
  ];
  const TYPES = [{ value: 'all', label: 'Everything' }, { value: 'radical', label: 'Radicals' }, { value: 'kanji', label: 'Kanji' }, { value: 'vocabulary', label: 'Vocabulary' }];
  const MAX_LEVEL = 60;

  // Kept for the visit, so coming back finds your last filters.
  const remembered = { field: 'all', type: 'all' };

  function mount(ctx) {
    const el = ctx.el;
    const $ = (s) => el.querySelector(s);
    let cancelled = false;
    let index = [];
    let loading = true;
    let downloading = null; // { done, total } while the rest of the levels are coming in
    let query = ctx.query || '';
    let shown = {};         // group key -> how many tiles are showing
    let timer = 0;

    el.innerHTML = `<div class="wrap search">
      <h1>Search</h1>
      <section class="panel">
        <div class="sbar">
          <input id="q" type="text" inputmode="search" enterkeyhint="search" placeholder="water, みず, mizu or 水" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Search by meaning, reading or kanji" value="${esc(query)}">
          <button type="button" class="link" id="q-clear" ${query ? '' : 'hidden'}>Clear</button>
        </div>
        <div class="est-form">
          <label class="ctl"><span>Search in</span>${UI.selectHTML('s-field', FIELDS, remembered.field, 'Search in')}</label>
          <label class="ctl"><span>Show</span>${UI.selectHTML('s-type', TYPES, remembered.type, 'Show')}</label>
        </div>
        <p class="muted" id="s-scope" aria-live="polite"></p>
      </section>
      <div id="s-results" aria-live="polite"></div>
    </div>`;

    const input = $('#q');
    const clear = $('#q-clear');

    UI.bindSelect($('#s-field').closest('[data-select]'), (v) => { remembered.field = v; shown = {}; render(); });
    UI.bindSelect($('#s-type').closest('[data-select]'), (v) => { remembered.type = v; shown = {}; render(); });

    input.addEventListener('input', () => {
      clear.hidden = !input.value;
      clearTimeout(timer);
      timer = setTimeout(() => { query = input.value; shown = {}; keepInAddressBar(); render(); }, 120);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; input.dispatchEvent(new Event('input')); }
      if (e.key === 'Enter') { clearTimeout(timer); query = input.value; shown = {}; keepInAddressBar(); render(); input.blur(); }
    });
    clear.addEventListener('click', () => { input.value = ''; clear.hidden = true; query = ''; shown = {}; keepInAddressBar(); render(); input.focus(); });
    // So reloading the page, or sharing the address, keeps the search. replaceState does not reload the screen.
    function keepInAddressBar() {
      const h = '#/search' + (query.trim() ? '/' + encodeURIComponent(query.trim()) : '');
      if (location.hash !== h) { try { history.replaceState(null, '', h); } catch (e) { /* ignore */ } }
    }

    function scopeLine() {
      const levels = Local.downloadedLevels();
      if (loading) return 'Getting your saved items ready…';
      if (downloading) return `Downloading the other levels… ${downloading.done} of ${downloading.total}`;
      const rest = MAX_LEVEL - levels.length;
      const text = `Searching ${index.length.toLocaleString()} items from ${levels.length === MAX_LEVEL ? 'all 60 levels' : levels.length === 1 ? '1 level' : levels.length + ' levels'} saved on this device.`;
      return rest > 0 ? `${text} <button type="button" class="link inline" id="s-all">Include the other ${rest}</button>` : text;
    }
    function drawScope() {
      const p = $('#s-scope');
      p.innerHTML = scopeLine();
      const b = $('#s-all');
      if (b) b.onclick = downloadRest;
    }

    async function downloadRest() {
      const levels = [];
      for (let l = 1; l <= MAX_LEVEL; l++) if (!Local.levelDone(l)) levels.push(l);
      downloading = { done: 0, total: levels.length };
      drawScope();
      try {
        await Local.downloadLevels(levels, (done, total) => { downloading = { done, total }; if (!cancelled) drawScope(); });
        if (cancelled) return;
        await buildIndex();
      } catch (e) {
        if (ctx.syncFailed) ctx.syncFailed(e);
        if (!cancelled) { ctx.toast('Could not download the other levels: ' + e.message); }
      }
      downloading = null;
      if (cancelled) return;
      drawScope();
      render();
    }

    async function buildIndex() {
      const subs = await Local.allSubjects();
      const syn = Local.synonyms(subs.map((x) => x.id));
      index = Search.build(subs, (id) => syn.get(id) || []);
    }

    function render() {
      if (cancelled) return;
      const box = $('#s-results');
      const q = query.trim();
      if (!q) {
        box.innerHTML = '<div class="panel muted s-hint"><p>Type a meaning like <b>water</b>, a reading like <b>みず</b> or <b>mizu</b>, or paste a kanji or word like <b>水</b>.</p><p>Tap any result for its details, with links to open it on WaniKani or Jisho.</p></div>';
        return;
      }
      if (loading) { box.innerHTML = '<div class="spinner"></div>'; return; }
      const results = Search.run(index, q, remembered);
      if (!results.length) {
        box.innerHTML = `<div class="panel s-none"><p><b>Nothing matches “${esc(q)}”.</b></p>
          <p class="muted">${remembered.field !== 'all' || remembered.type !== 'all' ? 'Try “Meaning, reading or kanji” and “Everything” above. ' : ''}${Local.downloadedLevels().length < MAX_LEVEL ? 'Only the levels saved on this device are searched; include the other levels above. ' : ''}Readings can be typed in kana or romaji.</p></div>`;
        return;
      }
      const groups = Search.group(results);
      box.innerHTML = `<p class="muted s-count">${results.length.toLocaleString()} ${results.length === 1 ? 'match' : 'matches'} for “${esc(q)}”</p>`
        + groups.map((g) => {
          const n = shown[g.key] || PAGE;
          return `<section class="group" data-group="${g.key}"><h2>${g.label} <span class="count">${g.items.length.toLocaleString()}</span></h2>
            <div class="tiles">${g.items.slice(0, n).map((r) => ctx.tile(r.s, Local.assignmentFor(r.s.id))).join('')}</div>
            ${g.items.length > n ? `<button type="button" class="btn ghost small s-more" data-more="${g.key}">Show ${Math.min(PAGE, g.items.length - n)} more (${(g.items.length - n).toLocaleString()} left)</button>` : ''}</section>`;
        }).join('');
    }
    $('#s-results').addEventListener('click', (e) => {
      const b = e.target.closest('[data-more]');
      if (!b) return;
      shown[b.dataset.more] = (shown[b.dataset.more] || PAGE) + PAGE;
      render();
    });

    ctx.setCleanup(() => { cancelled = true; clearTimeout(timer); });

    (async () => {
      render();
      drawScope();
      try { await buildIndex(); } catch (e) { if (ctx.syncFailed) ctx.syncFailed(e); }
      loading = false;
      if (cancelled) return;
      drawScope();
      render();
    })();
    if (!query) input.focus();
  }

  root.SearchView = { mount };
})(window);
