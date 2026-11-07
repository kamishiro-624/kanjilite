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
  document.addEventListener('click', (e) => {
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
