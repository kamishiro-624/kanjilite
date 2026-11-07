/* KanjiLite – Extra practice.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const S = KL.S;
  const { $, app, empty, ensureLocal, esc, go, loading, makeItem, route, runQuiz, settings, shuffle, tile } = KL;

  // ---------- reading classes ----------
  // Works out (and keeps on this device) which started vocabulary words are read differently from their kanji.
  // Needs the words and their kanji, which are downloaded once; later calls only handle words not seen before.
  async function ensureReadingClasses(assignments, stale) {
    const known = Practice.readClasses();
    const vocab = assignments.filter((a) => a.data.subject_type === 'vocabulary' && !known[a.data.subject_id]);
    if (!vocab.length) return known;
    const words = await api.getSubjects(vocab.map((a) => a.data.subject_id));
    if (stale && stale()) return known;
    const kanjiIds = new Set();
    words.forEach((w) => ((w.data && w.data.component_subject_ids) || []).forEach((id) => kanjiIds.add(id)));
    const kanji = await api.getSubjects([...kanjiIds]);
    if (stale && stale()) return known;
    const byChar = {};
    kanji.forEach((k) => { if (k.object === 'kanji' && k.data.characters) byChar[k.data.characters] = k; });
    const found = {};
    words.forEach((w, id) => { found[id] = Readings.classify(w, byChar); });
    return Practice.saveClasses(found);
  }

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
      classes: null, dakuten: settings.practiceDakuten,
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
    if (kind === 'readings') {
      loading('Checking the readings of your words… the first time this downloads them, so it can take a moment.');
      try { ctx.classes = await ensureReadingClasses(Local.allAssignments().filter((a) => !a.data.hidden && a.data.started_at && a.data.srs_stage >= 1), stale); } catch (e) { ctx.classes = null; }
      if (stale()) return;
      if (!ctx.classes || !Object.keys(ctx.classes).length) return empty('Could not check your words', 'Check your connection and try again.');
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
