/* KanjiLite – Workload guard: gathers the numbers for logic/guard.js and gates lessons.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const S = KL.S;
  const { $, go } = KL;

  // ---------- workload guard ----------
  // Warns when the lessons and reviews someone is piling up are more than they can keep up with (see logic/guard.js).

  /** Everything Guard.evaluate needs, from the saved copy of your data (no requests). hist and rs may still be null. */
  function guardContext(userId, level, hist, rs, frac) {
    const now = Date.now();
    const due = Local.reviewsDue().length;
    const week = now - 7 * 86400000;
    const today = Stats.dayKey(new Date(now));
    let apprentice = 0, lessons7 = 0, lessonsToday = 0;
    Local.allAssignments().forEach((a) => {
      const d = a.data;
      if (d.hidden) return;
      if (d.srs_stage >= 1 && d.srs_stage <= 4) apprentice++;
      if (d.started_at) {
        const t = Date.parse(d.started_at);
        if (t >= week) { lessons7++; if (Stats.dayKey(new Date(t)) === today) lessonsToday++; }
      }
    });
    return {
      now, due, next24: Math.max(0, Local.reviewsDueBy(now + 86400000) - due), apprentice, lessons7, lessonsToday,
      counts: Stats.dayCounts(hist), acc: rs ? Stats.accuracyOf(rs.rows) : null,
      plan: Plan.load(userId), pos: frac != null ? level + frac : null,
    };
  }

  /** The guard's verdict right now, from what is saved on this device. null until there is data. */
  async function guardNow() {
    const u = S.userCache ? S.userCache.u : null;
    if (!u || !Local.hasData()) return null;
    const [hist, rs] = await Promise.all([Stats.savedHistory().catch(() => null), Stats.savedReviewStats().catch(() => null)]);
    return Guard.evaluate(guardContext(u.id, u.level, hist, rs, S.lastFrac));
  }

  /** Before lessons (or another batch): if reviews are piled up, or today's safe amount is done, ask first.
      Only ever a prompt; "Start anyway" always works. Resolves true to carry on. */
  async function lessonsGate(another) {
    const p = Guard.prefs();
    if (!p.on || !p.gate) return true;
    let res = null;
    try { res = await guardNow(); } catch (e) { return true; }
    if (!res) return true;
    const a = res.allowance, m = res.m;
    if (a.paused) {
      const ok = await UI.confirm({
        title: 'Your reviews are piled up',
        message: `${m.due.toLocaleString()} reviews are due${m.appSev ? ` and ${m.apprentice} items are still in Apprentice` : ''}. New lessons now add to the pile, and the pile is what makes people quit. Clear some reviews first; the lessons will still be here.`,
        ok: 'Start lessons anyway', cancel: 'Reviews first',
      });
      if (!ok) go(m.due ? '#/reviews' : '#/');
      return ok;
    }
    if (another && a.allowed && a.done >= a.allowed) {
      const ok = await UI.confirm({
        title: 'That’s today’s safe amount',
        message: `You have started ${a.done} lessons today, which is ${a.hasPlan ? 'what your plan asks for' : 'about what you can sustain'} (${a.allowed}). More now means more reviews over the next few days. It is fine to stop here and carry on tomorrow.`,
        ok: 'Do another batch', cancel: 'Stop for today',
      });
      if (!ok) go('#/');
      return ok;
    }
    return true;
  }

  Object.assign(KL, { guardContext, guardNow, lessonsGate });
})(window.KL);
