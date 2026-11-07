/* KanjiLite – Search, stats, plan and level-browser views.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const S = KL.S;
  const { $, app, ensureLocal, go, loading, openSettings, syncFailed, tile, toast } = KL;

  // ---------- search ----------
  async function searchView(my, arg) {
    loading('Loading…');
    await ensureLocal();
    if (my !== S.routeSeq) return;
    let query = '';
    try { query = decodeURIComponent(arg || ''); } catch (e) { query = arg || ''; }
    SearchView.mount({ el: app, query, tile, toast, syncFailed, setCleanup: (fn) => { S.cleanup = fn; } });
  }

  // ---------- stats ----------
  async function statsView(my) {
    loading('Loading stats…');
    const user = await ensureLocal();
    if (my !== S.routeSeq) return;
    StatsView.mount({
      el: app,
      user,
      currentUser: () => (S.userCache ? S.userCache.u : user),
      tile,
      syncFailed,
      setCleanup: (fn) => { S.cleanup = fn; },
    });
  }

  // ---------- plan ----------
  async function planView(my) {
    loading('Loading plan…');
    const user = await ensureLocal();
    if (my !== S.routeSeq) return;
    PlanView.mount({
      el: app, user, toast, syncFailed, openSettings,
      currentUser: () => (S.userCache ? S.userCache.u : user),
      setCleanup: (fn) => { S.cleanup = fn; },
    });
  }

  // ---------- levels ----------
  async function levelsView(my, arg) {
    const stale = () => my !== S.routeSeq;
    loading('Loading level…');
    const user = await ensureLocal();
    const max = user.subscription && user.subscription.max_level_granted ? user.subscription.max_level_granted : 60;
    const lvl = Math.min(60, Math.max(1, Number(arg) || user.level));
    const subs = await Local.levelSubjects(lvl); // saved copy, or fetched once and kept
    if (stale()) return;
    const amap = { get: (id) => Local.assignmentFor(id) };
    const visible = subs.filter((s) => !s.data.hidden_at);
    const group = (types) => visible.filter((s) => types.includes(s.object)).sort((a, b) => a.data.lesson_position - b.data.lesson_position);
    const section = (title, list, opts) => (list.length ? `<div class="group"><h2>${title}</h2><div class="tiles">${list.map((s) => tile(s, amap.get(s.id) || null, opts)).join('')}</div></div>` : '');
    const kanjiList = group(['kanji']);
    const kDone = kanjiList.filter((s) => { const a = amap.get(s.id); return a && a.data.srs_stage >= 5; }).length;
    const kNeed = Math.ceil(kanjiList.length * 0.9);
    const kSummary = kanjiList.length ? `<p class="muted kanji-sum"><b>${kDone} of ${kanjiList.length}</b> kanji have reached Guru I or beyond. ${kNeed} are needed to pass this level.</p>` : '';

    app.innerHTML = `<div class="wrap">
      <div class="lvlbar"><h1 style="margin:0">Level</h1>
        ${UI.selectHTML('lvl-select', Array.from({ length: 60 }, (_, i) => i + 1).map((n) => ({ value: n, label: `${n}${n > max ? ' (locked by plan)' : ''}` })), lvl, 'Level')}</div>
      <div class="legend"><span><i style="background:#ffd23f"></i>Apprentice</span><span><i style="background:#5ce08f"></i>Guru</span><span><i style="background:#3dc5ff"></i>Master</span><span><i style="background:#fff;border:1px solid var(--line)"></i>Enlightened</span><span><i style="background:#111"></i>Burned</span><span>Faded means locked</span><span><i class="lg-prog"></i>Bar on a kanji: progress to Guru I</span></div>
      ${kSummary}
      ${section('Radicals', group(['radical']))}${section('Kanji', kanjiList, { guru: true })}${section('Vocabulary', group(['vocabulary', 'kana_vocabulary']))}
    </div>`;
    UI.bindSelect($('#lvl-select').closest('[data-select]'), (v) => go('#/levels/' + v));
  }

  Object.assign(KL, { levelsView, planView, searchView, statsView });
})(window.KL);
