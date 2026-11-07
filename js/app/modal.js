/* KanjiLite – The detail popup and the item-spread grid popup.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const { $, STAGES, dlg, esc, externalLinks, hero, renderInfo, tile } = KL;

  // ---------- modal ----------
  function openModal(html) {
    $('#modal-body').innerHTML = html;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });

  async function openSubject(id) {
    openModal('<div class="spinner"></div>');
    try {
      const s = (await api.getSubjects([id])).get(id);
      if (!s) throw new Error('Subject not found');
      const relIds = [].concat(s.data.component_subject_ids || [], (s.data.amalgamation_subject_ids || []).slice(0, 30));
      const related = await api.getSubjects(relIds);
      openModal((spreadBack ? '<button type="button" class="btn ghost small sp-back" data-sp-back>← Back to list</button>' : '') + hero(s) + externalLinks(s) + `<div class="info-body">${renderInfo(s, related)}</div>`);
    } catch (e) {
      openModal(`<p class="error">${esc(e.message)}</p>`);
    }
  }
  // Item spread: tapping a number (or a stage name) opens the grid of the items behind it.
  let spreadBack = null; // modal html to return to when an item was opened from one of those grids
  dlg.addEventListener('close', () => { spreadBack = null; });
  const SP_KINDS = { rad: 'Radicals', kan: 'Kanji', voc: 'Vocabulary', all: 'Items' };
  async function openSpread(key) {
    const [group, kind] = key.split(':');
    const row = Dash.SPREAD_ROWS.find((r) => r.key === group);
    const match = (a) => {
      const d = a.data;
      if (d.hidden || !(d.srs_stage >= 1)) return false;
      if (group !== 'all' && Dash.spreadGroup(d.srs_stage) !== group) return false;
      if (kind === 'rad') return d.subject_type === 'radical';
      if (kind === 'kan') return d.subject_type === 'kanji';
      if (kind === 'voc') return d.subject_type !== 'radical' && d.subject_type !== 'kanji';
      return true;
    };
    const list = Local.allAssignments().filter(match);
    const title = `${row ? row.label : 'All stages'} · ${SP_KINDS[kind] || 'Items'} (${list.length.toLocaleString()})`;
    openModal(`<h2 class="sp-title">${esc(title)}</h2><div class="spinner"></div>`);
    try {
      const subs = await api.getSubjects(list.map((a) => a.data.subject_id));
      const order = { radical: 0, kanji: 1 };
      const byStage = new Map();
      list.forEach((a) => {
        const st = a.data.srs_stage;
        if (!byStage.has(st)) byStage.set(st, []);
        byStage.get(st).push(a);
      });
      const parts = Array.from(byStage.keys()).sort((x, y) => x - y).map((st) => {
        const items = byStage.get(st)
          .map((a) => ({ a, s: subs.get(a.data.subject_id) })).filter((x) => x.s)
          .sort((x, y) => (order[x.a.data.subject_type] != null ? order[x.a.data.subject_type] : 2) - (order[y.a.data.subject_type] != null ? order[y.a.data.subject_type] : 2)
            || (x.s.data.level - y.s.data.level) || (x.s.id - y.s.id));
        return `<section class="sp-stage"><h3>${esc(STAGES[st])} <span class="muted">${byStage.get(st).length}</span></h3>
          <div class="tiles">${items.map((x) => tile(x.s, x.a)).join('')}</div></section>`;
      });
      openModal(`<div class="sp-view"><h2 class="sp-title">${esc(title)}</h2>${parts.join('') || '<p class="muted">Nothing here yet.</p>'}</div>`);
    } catch (e) {
      openModal(`<p class="error">${esc(e.message)}</p>`);
    }
  }
  // Coming up: tapping a time in the forecast lists the items that fall due then, with meaning and reading hidden.
  // A tap on an item reveals them, a second tap opens its details (with a way back to this list).
  const upLabel = (iso) => {
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    return d.toLocaleString([], sameDay ? { hour: 'numeric' } : { weekday: 'short', hour: 'numeric' });
  };
  async function openUpcoming(at) {
    const list = Local.reviewsAt(at);
    const title = `Coming up · ${upLabel(at)} (${list.length.toLocaleString()})`;
    openModal(`<h2 class="sp-title">${esc(title)}</h2><div class="spinner"></div>`);
    if (!list.length) { openModal(`<h2 class="sp-title">${esc(title)}</h2><p class="muted">Nothing is scheduled for this time any more.</p>`); return; }
    try {
      const subs = await api.getSubjects(list.map((a) => a.data.subject_id));
      const groups = [['kanji', 'Kanji'], ['vocabulary', 'Vocabulary'], ['radical', 'Radicals']];
      const kindOf = (a) => (a.data.subject_type === 'radical' ? 'radical' : a.data.subject_type === 'kanji' ? 'kanji' : 'vocabulary');
      const parts = groups.map(([kind, label]) => {
        const items = list.filter((a) => kindOf(a) === kind)
          .map((a) => ({ a, s: subs.get(a.data.subject_id) })).filter((x) => x.s)
          .sort((x, y) => (x.s.data.level - y.s.data.level) || (x.s.id - y.s.id));
        return items.length ? `<section class="sp-stage"><h3>${label} <span class="muted">${items.length}</span></h3>
          <div class="tiles">${items.map((x) => tile(x.s, x.a).replace('class="tile ', 'class="tile veil ')).join('')}</div></section>` : '';
      });
      openModal(`<div class="sp-view up-view"><h2 class="sp-title">${esc(title)}</h2>
        <div class="up-bar"><span class="muted">Tap an item to see its meaning and reading, tap again for its details.</span>
        <button type="button" class="btn ghost small" data-up-all>Show all</button></div>${parts.join('')}</div>`);
    } catch (e) {
      openModal(`<p class="error">${esc(e.message)}</p>`);
    }
  }
  document.addEventListener('click', (e) => {
    const up = e.target.closest('[data-up]');
    if (up) { spreadBack = null; openUpcoming(up.dataset.up); return; }
    const all = e.target.closest('[data-up-all]');
    if (all) {
      const tiles = [...document.querySelectorAll('.up-view .tile')];
      const hide = !tiles.some((t) => t.classList.contains('veil')); // everything is showing: hide it again
      tiles.forEach((t) => t.classList.toggle('veil', hide));
      all.textContent = hide ? 'Show all' : 'Hide all';
      return;
    }
    const veiled = e.target.closest('.up-view .tile.veil');
    if (veiled) {
      veiled.classList.remove('veil');
      const btn = document.querySelector('[data-up-all]');
      if (btn && !document.querySelector('.up-view .tile.veil')) btn.textContent = 'Hide all'; // everything is showing now
      return;
    }
    const sp = e.target.closest('[data-sp]');
    if (sp) { spreadBack = null; openSpread(sp.dataset.sp); return; }
    if (e.target.closest('[data-sp-back]')) { if (spreadBack) openModal(spreadBack); return; }
    const t = e.target.closest('[data-subject]');
    if (!t) return;
    if (t.closest('.sp-view')) spreadBack = $('#modal-body').innerHTML; else if (!t.closest('#modal-body')) spreadBack = null;
    openSubject(Number(t.dataset.subject));
  });

  Object.assign(KL, { openModal });
})(window.KL);
