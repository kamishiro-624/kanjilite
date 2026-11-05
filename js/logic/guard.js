/* Workload guard: notices when someone is setting themselves up for a review backlog, and says what to do about it.
   Pure maths and wording, no DOM and no network. The app gathers the numbers (see guardContext in app.js) and hands them in.

   Backlogs are the usual way people burn out: a few ambitious days of lessons, then a week of reviews nobody has the
   energy for, then the pile is too big to face. So the guard watches both the pile that exists now (reviews due,
   Apprentice items, days skipped) and the one being built (the lesson pace, the saved plan), and measures all of them
   against what the person actually manages: their own recent reviews a day, unless they set a limit themselves.

   Nothing here blocks anything. Every warning comes with a way back that still reaches the plan's goal. */
(function (root) {
  'use strict';

  const DAY = 24 * 3600 * 1000;
  const K = { ON: 'kl_guard', CAP: 'kl_guard_cap', GATE: 'kl_guard_gate', SNOOZE: 'kl_guard_snooze', LAST: 'kl_guard_last', PUSHED: 'kl_guard_pushed' };
  const DEFAULT_CAP = 150;          // reviews a day assumed until there is enough history to know
  const rd = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const wr = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* storage blocked */ } };
  const dk = (ms) => Stats.dayKey(new Date(ms));
  const dayAgo = (now, i) => { const d = new Date(now); d.setDate(d.getDate() - i); return d; };
  const n0 = (x) => Math.round(x).toLocaleString();
  const r1 = (x) => Math.round(x * 10) / 10;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  /** The person's settings: on/off, their own comfortable reviews a day (0 = work it out), and whether lessons ask first. */
  function prefs() {
    return {
      on: rd(K.ON) !== '0',
      cap: Math.max(0, Math.min(2000, Math.round(Number(rd(K.CAP)) || 0))),
      gate: rd(K.GATE) !== '0',
    };
  }

  /**
   * How many reviews a day this person can comfortably do. A limit set in Settings wins. Otherwise it is their average on
   * the days they reviewed in the last two weeks, plus 30% for a heavier day (at least 60), once there are four such days.
   * counts: { 'YYYY-MM-DD': reviews done }.
   */
  function capacity(counts, now, pref) {
    if (pref > 0) return { value: pref, auto: false, known: true };
    const vals = [];
    for (let i = 1; i <= 14; i++) { const c = (counts || {})[Stats.dayKey(dayAgo(now, i))] || 0; if (c > 0) vals.push(c); }
    if (vals.length >= 4) {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return { value: Math.min(600, Math.max(60, Math.round(mean * 1.3 / 5) * 5)), auto: true, known: true, typical: Math.round(mean) };
    }
    return { value: DEFAULT_CAP, auto: true, known: false };
  }

  /** Lessons a day that keep the reviews they create (averaged over two months) within `cap` a day, at this accuracy. */
  const safeLessons = (cap, acc) => Math.max(1, Math.floor(cap / Plan.reviewsPerDay(1, 60, acc)));

  /** The time since the last day with a review, in days (0 = today), or null with no history in the last two months. */
  function daysSinceReview(counts, now) {
    for (let i = 0; i <= 60; i++) if (((counts || {})[Stats.dayKey(dayAgo(now, i))] || 0) > 0) return i;
    return null;
  }

  /**
   * c: { now, due, next24 (reviews falling due in the next 24 hours), apprentice (items at Apprentice), counts (reviews per day),
   *      lessons7 (lessons started in the last 7 days), lessonsToday, acc (0..1 or null), plan (saved plan or null),
   *      pos (level plus how far through it, or null), prefs }
   * Returns { sev: 0|1|2, level, cap, warnings (worst first), recovery, allowance, m (the numbers behind it) }.
   */
  function evaluate(c) {
    const p = c.prefs || prefs();
    const now = c.now || Date.now();
    const cap = capacity(c.counts, now, p.cap);
    const C = cap.value;
    const acc = c.acc != null ? c.acc : Plan.DEFAULT_ACC;
    const due = c.due || 0, next24 = c.next24 || 0, app = c.apprentice || 0;
    const safe = safeLessons(C, acc);
    const lpd7 = (c.lessons7 || 0) / 7;
    const W = [];
    const add = (w) => W.push(w);

    // ---- the pile that exists now ----
    const hi = Math.max(2 * C, 160), lo = Math.max(C, 80);
    const backlog = due >= hi ? 2 : due >= lo ? 1 : 0;
    if (backlog) {
      add({
        id: 'backlog', sev: backlog,
        title: backlog === 2 ? 'Reviews are piling up' : 'Reviews are building up',
        text: `${n0(due)} reviews are due, about ${r1(due / C)} days of work at your pace. ${backlog === 2 ? 'Backlogs this size are the main reason people burn out and quit. ' : ''}Several short sessions are easier to finish than one marathon, and new lessons can wait until this shrinks.`,
        short: `${n0(due)} reviews are due. Clear some before starting new lessons.`,
        action: { label: 'Start reviews', href: '#/reviews' },
      });
    } else if (due + next24 >= Math.max(1.5 * C, 120)) {
      add({
        id: 'ahead', sev: 1,
        title: 'A heavy day is coming',
        text: `${n0(due)} reviews are due now and ${n0(next24)} more fall due in the next 24 hours. Doing some now spreads it out; adding lessons today would make tomorrow heavier still.`,
        short: `${n0(due + next24)} reviews over the next 24 hours. Go easy on new lessons today.`,
        action: { label: 'Start reviews', href: '#/reviews' },
      });
    }

    const aw = Math.min(100, Math.max(50, Math.round(C * 0.7 / 5) * 5)), ah = Math.round(aw * 1.5);
    const appSev = app >= ah ? 2 : app >= aw ? 1 : 0;
    if (appSev) {
      add({
        id: 'apprentice', sev: appSev,
        title: `${n0(app)} items in Apprentice`,
        text: `New items come back for review after 4 hours, 8 hours, a day and two days, so a full Apprentice stage means a lot of reviews very soon. Let some move up to Guru before adding more (more than about ${aw} is where it starts to hurt).`,
        short: `${n0(app)} items are still in Apprentice. Let some move up before more lessons.`,
        action: due ? { label: 'Start reviews', href: '#/reviews' } : null,
      });
    }

    const since = daysSinceReview(c.counts, now);
    if (since != null && since >= 2 && due >= 30) {
      const sev = since >= 4 || backlog === 2 ? 2 : 1;
      add({
        id: 'skipped', sev,
        title: `${plural(since, 'day')} since your last review`,
        text: 'A short session today does more than a perfect one next week. Even 20 reviews stop the pile growing, and the streak is easier to restart than to rebuild.',
        short: `${plural(since, 'day')} without reviews and ${n0(due)} are waiting. A short session helps.`,
        action: { label: 'Do a short session', href: '#/reviews' },
      });
    }

    // ---- the pile being built ----
    const proj = Plan.reviewsPerDay(lpd7, 60, acc);
    const paceSev = lpd7 >= 3 && proj > C * 1.15 ? (proj > C * 1.6 ? 2 : 1) : 0;
    if (paceSev) {
      const planBit = c.plan && c.plan.lpd
        ? ` Your plan asks for ${r1(c.plan.lpd)} a day${lpd7 > c.plan.lpd * 1.3 ? ', so you can ease off without missing your date.' : '.'}` : '';
      add({
        id: 'pace', sev: paceSev,
        title: 'Your lesson pace is more than you can keep up',
        text: `You started about ${r1(lpd7)} lessons a day this week. Over the next two months that brings around ${n0(proj)} reviews a day from new lessons alone, above the ${n0(C)} you are comfortable with. About ${safe} a day is sustainable.${planBit}`,
        short: `About ${r1(lpd7)} lessons a day is more than you can keep up. ${safe} a day is sustainable.`,
        action: null,
      });
    }

    if (c.plan && c.plan.target && c.plan.end > now && (c.pos == null || c.pos < c.plan.target)) {
      const pk = c.plan.rpk || (c.plan.rpd || 0) * 1.3;
      if (pk > C * 1.25) {
        const sev = pk > C * 1.9 ? 2 : 1;
        add({
          id: 'plan', sev,
          title: 'Your plan is heavier than you are used to',
          text: `It averages about ${n0(c.plan.rpd || pk)} reviews a day and about ${n0(pk)} in its busiest weeks, against the ${n0(C)} you are comfortable with. Moving the date back a little keeps the same goal with a much lighter load.`,
          short: `Your plan needs about ${n0(pk)} reviews a day at its busiest. A later date would be safer.`,
          action: { label: 'Open plan', href: '#/plan' },
        });
      }
    }

    W.sort((a, b) => b.sev - a.sev);
    const sev = W.reduce((m, w) => Math.max(m, w.sev), 0);

    // ---- lessons today ----
    const lessonSev = Math.max(backlog, appSev);
    const goal = c.plan && c.plan.lpd ? Math.max(1, Math.round(c.plan.lpd)) : safe;
    const allowed = lessonSev >= 2 ? 0 : lessonSev === 1 ? Math.max(1, Math.floor(goal / 2)) : goal;
    const done = c.lessonsToday || 0;
    const allowance = { goal, allowed, done, left: Math.max(0, allowed - done), paused: lessonSev >= 2, eased: lessonSev === 1, safe, hasPlan: !!(c.plan && c.plan.lpd) };

    // ---- the way back ----
    let recovery = null;
    if (backlog || (since != null && since >= 2 && due >= 30) || appSev) {
      const daily = Math.max(Math.round(C * 1.2 / 5) * 5, next24 + 20);
      const net = Math.max(10, daily - next24);
      const days = Math.max(1, Math.ceil(due / net));
      const delay = lessonSev >= 2 ? days : lessonSev === 1 ? days / 2 : 0;
      let planText = '';
      if (c.plan && c.pos != null && delay > 0) {
        const left = (c.plan.end - now) / DAY;
        if (left > 0) {
          const fastest = Plan.fastestDays(c.pos, c.plan.target);
          const after = left - delay;
          if (after < fastest) {
            planText = `At this point the plan’s date is tight: slowing lessons now would push level ${c.plan.target} back by about ${plural(Math.ceil(fastest - after), 'day')}. That is a better trade than a backlog you abandon.`;
          } else {
            const extra = Math.round((left / after - 1) * 100);
            planText = `This costs about ${plural(Math.max(1, Math.round(delay)), 'day')} of schedule. Making it up later takes ${extra < 1 ? 'a barely noticeable' : `about ${extra}% more`} lessons a day, and level ${c.plan.target} by your date still works.${extra >= 25 ? ' That is sizeable, so moving the date is worth considering.' : ''}`;
          }
        }
      }
      recovery = {
        daily, days, lessonsPaused: lessonSev >= 2, lessonsEased: lessonSev === 1, planText,
        sessionTip: due >= 120 ? 50 : 0,
      };
    }

    return {
      sev, level: sev === 2 ? 'high' : sev === 1 ? 'watch' : 'ok', cap, warnings: W, recovery, allowance,
      m: { due, next24, apprentice: app, lpd7, proj, safe, since, backlog, appSev, lessonSev },
    };
  }

  // ---- "Not today" ----
  function snoozed(w) {
    try { const s = (JSON.parse(rd(K.SNOOZE)) || {})[w.id]; return !!s && s.day === dk(Date.now()) && s.sev >= w.sev; } catch (e) { return false; }
  }
  function snooze(w) {
    let m = {};
    try { m = JSON.parse(rd(K.SNOOZE)) || {}; } catch (e) { m = {}; }
    const today = dk(Date.now());
    Object.keys(m).forEach((id) => { if (!m[id] || m[id].day !== today) delete m[id]; });
    m[w.id] = { day: today, sev: w.sev };
    wr(K.SNOOZE, JSON.stringify(m));
  }
  /** The warnings to show: everything not dismissed today (a warning that gets worse comes back). */
  const visible = (res) => (res && prefs().on ? res.warnings.filter((w) => !snoozed(w)) : []);

  /** A line for a toast, at most once a day unless things get worse. null when there is nothing new to say. */
  function toAnnounce(res) {
    const top = visible(res)[0];
    if (!top) return null;
    const today = dk(Date.now());
    let last = {};
    try { last = JSON.parse(rd(K.LAST)) || {}; } catch (e) { last = {}; }
    if (last.day === today && last.sev >= top.sev) return null;
    wr(K.LAST, JSON.stringify({ day: today, sev: top.sev }));
    return top.short;
  }

  /** For a background notification: the worst warning, once a day (again if it gets worse). null otherwise. */
  function toPush(res) {
    const top = res && res.warnings[0];
    if (!top || top.sev < 2 || !prefs().on) return null;
    const today = dk(Date.now());
    let last = {};
    try { last = JSON.parse(rd(K.PUSHED)) || {}; } catch (e) { last = {}; }
    if (last.day === today && last.id === top.id) return null;
    wr(K.PUSHED, JSON.stringify({ day: today, id: top.id }));
    return { title: top.title, body: top.short };
  }

  /** What to say after a batch of lessons: what they add, and where that leaves today. */
  function afterLessons(res, started) {
    const a = res.allowance;
    const reviews = Math.round(started * 4 * (1 + (1 - Math.min(1, Math.max(0.5, Plan.DEFAULT_ACC)))));
    let line = `${plural(started, 'lesson')} started, which means about ${n0(reviews)} more reviews over the next four days.`;
    if (a.paused) line += ' Your reviews are piled up, so this is a good place to stop for today.';
    else if (a.allowed && a.done >= a.allowed) line += ` That is today’s safe amount (${a.allowed}). The rest can wait until tomorrow.`;
    else if (a.allowed) line += ` Today’s safe amount is ${a.allowed}; you are at ${a.done}.`;
    return line;
  }

  /** What to say after a review session: good news when the pile is small, a nudge when it is not. */
  function afterReviews(res, before) {
    if (res.sev === 0) return before && before.sev >= 1 ? { good: true, text: 'Your reviews are back under control. Nice work.' } : null;
    const b = res.warnings.find((w) => w.id === 'backlog');
    if (b) return { good: false, text: `${n0(res.m.due)} reviews are still due. Another short session soon keeps it moving.` };
    return null;
  }

  root.Guard = { prefs, capacity, safeLessons, daysSinceReview, evaluate, visible, snooze, snoozed, toAnnounce, toPush, afterLessons, afterReviews, KEYS: K, DEFAULT_CAP };
})(typeof window !== 'undefined' ? window : globalThis);
