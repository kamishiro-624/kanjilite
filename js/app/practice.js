/* KanjiLite – Extra practice.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const S = KL.S;
  const { $, app, empty, ensureLocal, esc, go, loading, makeItem, route, runQuiz, settings, shuffle, tile } = KL;

  // ---------- extra practice ----------
  // Quizzes on items you already know. Same screen as a review, but nothing is sent to WaniKani and no SRS stage moves.
  async function practiceView(my, kind) {
    const stale = () => my !== S.routeSeq;
    const def = Practice.KINDS.find((k) => k.key === kind);
    if (!def) return go('#/');
    loading('Getting your practice ready…');
    const user = await ensureLocal();
    if (stale()) return;
    const ctx = {
      all: Local.allAssignments(), assignmentFor: Local.assignmentFor, mistakes: Practice.readLog(user.id),
      rows: null, levelIds: null, size: settings.practiceSize,
    };
    if (kind === 'critical') {
      const rs = await Stats.savedReviewStats().catch(() => null);
      ctx.rows = rs ? rs.rows : null;
      if (!ctx.rows) {
        try { ctx.rows = (await Stats.syncReviewStats({ background: false })).rows; } catch (e) { ctx.rows = null; }
      }
      if (stale()) return;
      if (!ctx.rows) return empty('Could not load your statistics', 'Check your connection and try again.');
    }
    if (kind === 'level') {
      const subs = await Local.levelSubjects(user.level).catch(() => null);
      if (stale()) return;
      if (!subs) return empty('Could not load this level', 'Check your connection and try again.');
      ctx.levelIds = new Set(subs.filter((x) => !x.data.hidden_at).map((x) => x.id));
    }
    const picked = Practice.select(kind, ctx).items;
    if (!picked.length) return empty('Nothing to practise here yet', def.empty);

    const ids = picked.map((a) => a.data.subject_id);
    const subs = await api.getSubjects(ids);
    const synonyms = Local.synonyms(ids);
    if (stale()) return;
    const items = picked.filter((a) => subs.has(a.data.subject_id)).map((a) => makeItem(a, subs.get(a.data.subject_id), synonyms.get(a.data.subject_id)));
    if (!items.length) return empty('Nothing to practise here yet', def.empty);
    shuffle(items);
    runPractice(items, def, my);
  }

  function runPractice(items, def, my, again) {
    runQuiz({
      items,
      practice: true,
      quitMessage: 'Quit this practice? Nothing is lost, and nothing here changes your WaniKani progress.',
      onFinish: (st) => {
        if (my !== S.routeSeq) return;
        const accuracy = st.answered ? Math.round(st.correct / st.answered * 100) : 100;
        const missed = st.done.filter((i) => i.incorrect.meaning + i.incorrect.reading > 0);
        app.innerHTML = `<div class="wrap">
          <div class="center"><h1>Practice complete</h1>
          <p>${esc(def.title)}: ${items.length} item${items.length === 1 ? '' : 's'}, ${accuracy}% of answers correct.</p>
          <p class="muted">This did not change your WaniKani progress.</p></div>
          ${missed.length ? `<div class="panel"><h2>Items you missed</h2><div class="tiles">${missed.map((i) => tile(i.subject)).join('')}</div></div>` : ''}
          <div class="row" style="justify-content:center">
            ${missed.length ? '<button type="button" class="btn" id="p-missed">Practise the missed ones</button>' : ''}
            <a class="btn${missed.length ? ' ghost' : ''}" href="#/practice/${esc(def.key)}" id="p-again">Practise more</a>
            <a class="btn ghost" href="#/">Back home</a>
          </div></div>`;
        const mb = $('#p-missed');
        if (mb) mb.onclick = () => {
          const redo = missed.map((i) => makeItem(i.assignment, i.subject, i.synonyms));
          runPractice(shuffle(redo), Object.assign({}, def, { title: def.title + ' (missed)' }), my);
        };
        const ag = $('#p-again');
        if (ag) ag.addEventListener('click', (e) => { e.preventDefault(); route(); });
      },
    });
  }

  Object.assign(KL, { practiceView });
})(window.KL);
