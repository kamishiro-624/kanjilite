/* Extra practice: which items each practice set holds. Plain functions, no DOM; app.js supplies the data
   and runs the quiz. Practice never touches WaniKani: nothing here changes an SRS stage.

   Sets: recently learned, recent mistakes, critical condition (under 75% correct), Apprentice items,
   the current level, burned items, and vocabulary whose reading is new or differs from its kanji (see logic/readings.js).

   Mistakes are logged on this device only (what you get wrong in reviews and in practice), newest first. */
(function (root) {
  'use strict';

  const LOG_KEY = 'kl_practice_mistakes';
  const LOG_MAX = 300;

  const KINDS = [
    { key: 'recent', title: 'Recently learned', desc: 'The items you started lessons on most recently', empty: 'Items show up here once you have started some lessons.' },
    { key: 'mistakes', title: 'Recent mistakes', desc: 'Items you got wrong lately, in reviews or practice', empty: 'Items you miss in reviews or practice on this device show up here.' },
    { key: 'critical', title: 'Critical condition', desc: 'Items you get right less than 75% of the time', empty: 'No item is under 75% right now. They show up once you have answered them a few times.' },
    { key: 'apprentice', title: 'Apprentice items', desc: 'A random pick of items still at the early stages', empty: 'You have no items at Apprentice right now.' },
    { key: 'level', title: 'Current level', desc: 'A random pick of what you have started on this level', empty: 'You have not started any items on this level yet.' },
    { key: 'readings', title: 'Different readings', desc: 'Words read differently from their kanji (大人 おとな) or with a reading the kanji lessons did not teach (選ぶ)', empty: 'None of the words you have started use a different or new reading yet. Words with dakuten-changed readings can be added in Settings.', lazy: true },
    { key: 'burned', title: 'Burned items', desc: 'Check that the ones you burned have really stuck', empty: 'You have not burned anything yet.' },
  ];

  /** How a session's items are picked and ordered. 'default' keeps each set's own way (a random pick, or newest / worst first).
      Any other choice sorts the whole set and takes the first items from the top. */
  const ORDERS = [
    { value: 'default', label: 'Set default' },
    { value: 'newest', label: 'Most recently learned first' },
    { value: 'oldest', label: 'Longest ago learned first' },
    { value: 'level-asc', label: 'Level: low to high' },
    { value: 'level-desc', label: 'Level: high to low' },
    { value: 'acc-asc', label: 'Accuracy: low to high' },
    { value: 'acc-desc', label: 'Accuracy: high to low' },
    { value: 'srs-asc', label: 'SRS stage: low to high' },
    { value: 'srs-desc', label: 'SRS stage: high to low' },
  ];
  const orderValue = (v) => (ORDERS.some((o) => o.value === v) ? v : 'default');
  /** What a sort needs besides the assignments: 'level' (ctx.levelOf) or 'accuracy' (ctx.rows). */
  const orderNeeds = (v) => (/^level/.test(v) ? 'level' : /^acc/.test(v) ? 'accuracy' : null);

  const startedAt = (a) => Date.parse(a.data.started_at) || 0;
  /** Percent of answers that were right (meaning and reading together), or null if the item has no statistics yet. */
  function accuracyOf(rows, subjectId) {
    const r = rows && rows[subjectId];
    if (!r) return null;
    const total = r[1] + r[2] + r[3] + r[4];
    return total ? (r[1] + r[3]) / total * 100 : null;
  }

  /** A sorted copy of the pool. Ties go to the more recently learned item. Items with no value to sort by come last. */
  function sortPool(pool, order, ctx) {
    const key = {
      newest: (a) => startedAt(a), oldest: (a) => startedAt(a),
      'level-asc': (a) => ctx.levelOf(a.data.subject_id), 'level-desc': (a) => ctx.levelOf(a.data.subject_id),
      'acc-asc': (a) => accuracyOf(ctx.rows, a.data.subject_id), 'acc-desc': (a) => accuracyOf(ctx.rows, a.data.subject_id),
      'srs-asc': (a) => a.data.srs_stage, 'srs-desc': (a) => a.data.srs_stage,
    }[order];
    if (!key) return pool.slice();
    const dir = /-desc$|^newest$/.test(order) ? -1 : 1;
    const rows = pool.map((a) => ({ a, k: key(a) }));
    rows.sort((x, y) => {
      const xn = x.k == null, yn = y.k == null;
      if (xn !== yn) return xn ? 1 : -1;
      return ((xn ? 0 : (x.k - y.k) * dir)) || (startedAt(y.a) - startedAt(x.a));
    });
    return rows.map((r) => r.a);
  }

  const shuffled = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

  // ---------------------------------------------------------------- mistake log

  /** Newest first: [{ id: subject id, t: ms }]. Only the log of the signed-in account is returned. */
  function readLog(uid) {
    try {
      const v = JSON.parse(localStorage.getItem(LOG_KEY) || 'null');
      return v && v.uid === uid && Array.isArray(v.list) ? v.list : [];
    } catch (e) { return []; }
  }

  function noteMistakes(uid, subjectIds, now) {
    if (uid == null || !subjectIds.length) return;
    try {
      const t = now || Date.now();
      const gone = new Set(subjectIds);
      const list = subjectIds.map((id) => ({ id, t })).concat(readLog(uid).filter((m) => !gone.has(m.id))).slice(0, LOG_MAX);
      localStorage.setItem(LOG_KEY, JSON.stringify({ uid, list }));
    } catch (e) { /* storage unavailable: practice still works, the log just does not grow */ }
  }

  // ---------------------------------------------------------------- reading classes
  // Which of your vocabulary words are read differently from their kanji. Working it out needs the word and its kanji
  // (downloaded once), so the result is kept: { subject id: 'r' regular | 'w' new reading | 'k' dakuten | 'd' different | 'n' no kanji }.
  const CLASS_KEY = 'kl_reading_classes';
  const CODE = { regular: 'r', new: 'w', dakuten: 'k', different: 'd', none: 'n' };

  function readClasses() {
    try {
      const v = JSON.parse(localStorage.getItem(CLASS_KEY) || 'null');
      return v && v.v === root.Readings.VERSION && v.m && typeof v.m === 'object' ? v.m : {};
    } catch (e) { return {}; }
  }
  /** Adds results ({ subject id: class name from Readings.classify }); 'unknown' is left out so it is tried again. */
  function saveClasses(found) {
    const m = readClasses();
    Object.keys(found).forEach((id) => { if (CODE[found[id]]) m[id] = CODE[found[id]]; });
    try { localStorage.setItem(CLASS_KEY, JSON.stringify({ v: root.Readings.VERSION, m })); } catch (e) { /* storage unavailable: worked out again next time */ }
    return m;
  }

  // ---------------------------------------------------------------- choosing items

  /** An item you can practise: started, not hidden, not back in the lesson queue. */
  const eligible = (a) => !!a && !a.data.hidden && !!a.data.started_at && a.data.srs_stage >= 1;

  /**
   * ctx: { all: every assignment, assignmentFor(subjectId), mistakes: log, rows: review statistics (or null),
   *        levelIds: Set of this level's subject ids (or null), size,
   *        order: one of ORDERS (default 'default'), levelOf(subjectId): the item's level (needed by the level orders) }
   * Returns { ready, total, items, pool }: pool is every item in the set (unsorted), and ready is false while the data a set needs is still loading, total is how many
   * items are in the set, items is what a session holds (at most `size`; the "recent" sets are newest first,
   * the others a random pick).
   */
  function select(kind, ctx) {
    const size = Math.max(1, Math.floor(ctx.size) || 20);
    const all = ctx.all.filter(eligible);
    let pool = [], ordered = false, ready = true;
    switch (kind) {
      case 'recent':
        pool = all.slice().sort((a, b) => Date.parse(b.data.started_at) - Date.parse(a.data.started_at));
        ordered = true;
        break;
      case 'mistakes': {
        const seen = new Set();
        (ctx.mistakes || []).forEach((m) => {
          const a = ctx.assignmentFor(m.id);
          if (eligible(a) && !seen.has(a.id)) { seen.add(a.id); pool.push(a); }
        });
        ordered = true;
        break;
      }
      case 'critical': {
        if (!ctx.rows) { ready = false; break; }
        const live = (id) => { const a = ctx.assignmentFor(id); return eligible(a) && a.data.srs_stage < 9; };
        pool = root.Stats.criticalItems(ctx.rows, live, { below: 75, limit: 1e6 }).items.map((x) => ctx.assignmentFor(x.id));
        ordered = true; // worst first
        break;
      }
      case 'apprentice': pool = all.filter((a) => a.data.srs_stage <= 4); break;
      case 'level':
        if (!ctx.levelIds) { ready = false; break; }
        pool = all.filter((a) => ctx.levelIds.has(a.data.subject_id));
        break;
      case 'readings': {
        // ctx.classes: readClasses(); ctx.dakuten: also include words whose reading only differs by a voiced sound.
        if (!ctx.classes || !Object.keys(ctx.classes).length) { ready = false; break; }
        pool = all.filter((a) => {
          const c = ctx.classes[a.data.subject_id];
          return a.data.subject_type === 'vocabulary' && (c === 'd' || c === 'w' || (ctx.dakuten && c === 'k'));
        });
        break;
      }
      case 'burned': pool = all.filter((a) => a.data.srs_stage === 9); break;
      default: break;
    }
    const order = orderValue(ctx.order);
    if (ready && order !== 'default') {
      const need = orderNeeds(order);
      if (need === 'level' && !ctx.levelOf) ready = false;
      else if (need === 'accuracy' && !ctx.rows) ready = false;
      else return { ready, total: pool.length, items: sortPool(pool, order, ctx).slice(0, size), pool };
    }
    return { ready, total: pool.length, items: ordered ? pool.slice(0, size) : shuffled(pool).slice(0, size), pool };
  }

  /** How many items a set holds, or null while it is still loading. */
  function count(kind, ctx) {
    const r = select(kind, ctx);
    return r.ready ? r.total : null;
  }

  root.Practice = { KINDS, ORDERS, orderValue, orderNeeds, select, count, readLog, noteMistakes, readClasses, saveClasses };
})(window);
