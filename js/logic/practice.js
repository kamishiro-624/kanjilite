/* Extra practice: which items each practice set holds. Plain functions, no DOM; app.js supplies the data
   and runs the quiz. Practice never touches WaniKani: nothing here changes an SRS stage.

   Sets: recently learned, recent mistakes, critical condition (under 75% correct), Apprentice items,
   the current level, and burned items.

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
    { key: 'burned', title: 'Burned items', desc: 'Check that the ones you burned have really stuck', empty: 'You have not burned anything yet.' },
  ];

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

  // ---------------------------------------------------------------- choosing items

  /** An item you can practise: started, not hidden, not back in the lesson queue. */
  const eligible = (a) => !!a && !a.data.hidden && !!a.data.started_at && a.data.srs_stage >= 1;

  /**
   * ctx: { all: every assignment, assignmentFor(subjectId), mistakes: log, rows: review statistics (or null),
   *        levelIds: Set of this level's subject ids (or null), size }
   * Returns { ready, total, items }: ready is false while the data a set needs is still loading, total is how many
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
      case 'burned': pool = all.filter((a) => a.data.srs_stage === 9); break;
      default: break;
    }
    return { ready, total: pool.length, items: ordered ? pool.slice(0, size) : shuffled(pool).slice(0, size) };
  }

  /** How many items a set holds, or null while it is still loading. */
  function count(kind, ctx) {
    const r = select(kind, ctx);
    return r.ready ? r.total : null;
  }

  root.Practice = { KINDS, select, count, readLog, noteMistakes };
})(window);
