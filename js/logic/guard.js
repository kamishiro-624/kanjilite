/* Workload guard: notices when someone is setting themselves up for a review backlog, and says what to do about it.
   Pure maths and wording, no DOM and no network. The app gathers the numbers (see guardContext in app.js) and hands them in.

   The workload is worked out from the real schedule: every item you have started is followed through its remaining\n   reviews (4 hours, 8 hours, a day, two days, a week...), so reviews coming back from Guru and Master count as well as\n   Apprentice ones. Reviews only unlock when they are due, so nothing here asks for a number of reviews to be done: it\n   says what is coming, what can wait, and how many lessons still fit.\n\n   Backlogs are the usual way people burn out: a few ambitious days of lessons, then a week of reviews nobody has the
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

  // Hours an item waits after being answered correctly into each stage (WaniKani's standard intervals).
  const WAIT_H = { 1: 4, 2: 8, 3: 23, 4: 47, 5: 167, 6: 335, 7: 719, 8: 2879 };
  const HOUR = 3600 * 1000;

  /**
   * The reviews already on the calendar, followed forward: each item is reviewed when it falls due (or now, if it is
   * overdue), is assumed to be answered correctly, and then waits for its next stage's interval, and so on. Mistakes add
   * repeats, so the counts are scaled by the usual retry factor for this accuracy.
   * items: [{ stage (1..8), at (ms, when it falls due) }]. Returns { raw, days, avg, peak, peakDay } for the next `n`
   * days counted from `now` in 24-hour steps (day 0 includes everything already due).
   */
  function forecast(items, now, n, acc) {
    const rf = 1 + (1 - Math.min(1, Math.max(0.5, acc == null ? 0.85 : acc)));
    const raw = new Array(n).fill(0);
    (items || []).forEach((it) => {
      let s = it.stage, t = Math.max(it.at, now);
      if (!(s >= 1 && s <= 8) || !Number.isFinite(t)) return;
      for (;;) {
        const b = Math.floor((t - now) / DAY);
        if (b >= n) break;
        raw[b] += rf;
        s += 1;
        if (s >= 9) break;
        t += WAIT_H[s] * HOUR;
      }
    });
    const days = raw.map((x) => Math.round(x));
    let peak = 0, peakDay = 0;
    days.forEach((x, i) => { if (x > peak) { peak = x; peakDay = i; } });
    return { raw, days, avg: days.reduce((a, b) => a + b, 0) / n, peak, peakDay };
  }

  /** Extra reviews, per day for the next week, that one lesson started now brings (4 hours, 12 hours, 35 hours, ...). */
  const lessonProfile = (now, acc) => forecast([{ stage: 1, at: now + 4 * HOUR }], now, 7, acc).raw;

  /** Lessons a day that keep the reviews they create (averaged over two months) within `cap` a day, at this accuracy. */
  const safeLessons = (cap, acc) => Math.max(1, Math.floor(cap / Plan.reviewsPerDay(1, 60, acc)));

  /** The time since the last day with a review, in days (0 = today), or null with no history in the last two months. */
  function daysSinceReview(counts, now) {
    for (let i = 0; i <= 60; i++) if (((counts || {})[Stats.dayKey(dayAgo(now, i))] || 0) > 0) return i;
    return null;
  }

  /**
   * c: { now, due, next24 (reviews falling due in the next 24 hours), apprentice (items at Apprentice), items (every started
   *      item still to review, [{ stage, at }], for the forecast), counts (reviews per day),
   *      lessons7 (lessons started in the last 7 days), lessonsToday, acc (0..1 or null), plan (saved plan or null),
   *      pos (level plus how far through it, or null), prefs }
   * Returns { sev: 0|1|2, level, cap, warnings (worst first), recovery, allowance, forecast, m (the numbers behind it) }.
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
    }
    const fc = forecast(c.items, now, 7, acc);
    const day0 = Math.max(fc.days[0], due), day1 = fc.days[1];
    if (!backlog && Math.max(day0, day1) >= Math.max(1.5 * C, 120)) {
      add({
        id: 'ahead', sev: 1,
        title: 'A heavy day is coming',
        text: `About ${n0(day0)} reviews come up over the next 24 hours (${n0(due)} already due)${day1 >= C ? `, then about ${n0(day1)} the day after` : ''}. That includes the repeats of items you answer today. Reviews unlock on their own schedule, so just do what is ready, in short sessions, and skip new lessons today.`,
        short: `About ${n0(Math.max(day0, day1))} reviews over the next day or two. Go easy on new lessons.`,
        action: due ? { label: 'Start reviews', href: '#/reviews' } : null,
      });
    }

    // The days after today, from everything that is already scheduled (Apprentice, Guru, Master... all of it). Today is left
    // out here because a backlog is judged above and would otherwise be counted twice.
    const rest = fc.days.slice(1);
    const restAvg = rest.reduce((x, y) => x + y, 0) / rest.length;
    let restPeak = 0, restPeakDay = 1;
    rest.forEach((x, i) => { if (x > restPeak) { restPeak = x; restPeakDay = i + 1; } });
    const loadSev = restAvg >= 40 && restAvg >= 1.4 * C ? 2 : restAvg >= 40 && restAvg >= C ? 1 : 0;
    const when = (d) => (d === 1 ? 'tomorrow' : `in ${d} days`);
    if (loadSev) {
      add({
        id: 'load', sev: loadSev,
        title: loadSev === 2 ? 'The coming week is already very heavy' : 'The coming week is already heavy',
        text: `The reviews already scheduled come to about ${n0(restAvg)} a day over the next week, up to ${n0(restPeak)} ${when(restPeakDay)}, against the ${n0(C)} you usually manage. That is before any new lessons${app ? ` (${n0(app)} items are in Apprentice and come back several more times in the next days)` : ''}. Reviews cannot be done early, so the way to lighten it is to hold off on new lessons until it eases.`,
        short: `About ${n0(restAvg)} reviews a day are already scheduled for the next week. Hold off on new lessons.`,
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
    // How many more lessons fit: each one brings reviews over the next days (about 2 today, 1 tomorrow, then a few
    // more), added to what is already scheduled, so room is however many it takes to reach your usual daily amount.
    // Lessons you have already started are in the schedule, so doing them uses room but never moves the total.
    const lessonSev = Math.max(backlog, loadSev);
    const paused = lessonSev >= 2;
    const goal = c.plan && c.plan.lpd ? Math.max(1, Math.round(c.plan.lpd)) : safe;
    const prof = lessonProfile(now, acc);
    let room = Infinity;
    prof.forEach((x, d) => { if (x > 0.05) room = Math.min(room, Math.floor((C - Math.max(fc.raw[d], d === 0 ? due : 0)) / x)); });
    room = Number.isFinite(room) ? Math.max(0, room) : 99;
    const done = c.lessonsToday || 0;
    // Never below what is already done (saying "9 today" after 18 is nonsense).
    const allowed = paused ? 0 : Math.max(done, Math.min(goal, done + room));
    const allowance = { goal, allowed, done, left: Math.max(0, allowed - done), paused, eased: !paused && allowed < goal, room, safe, hasPlan: !!(c.plan && c.plan.lpd) };

    // ---- the way back ----
    // No quota is set: reviews can only be done once they are due. This says what is ready, what is coming and roughly
    // how long the pile takes at your usual pace.
    let recovery = null;
    const skipped = since != null && since >= 2 && due >= 30;
    if (backlog || skipped || loadSev) {
      const pace = Math.max(Math.round(C * 1.2 / 5) * 5, next24 + 20);
      const net = Math.max(10, pace - next24);
      let days;
      if (backlog || skipped) days = Math.max(1, Math.ceil(due / net));
      else { const i = rest.findIndex((x) => x < 0.9 * C); days = i < 0 ? 7 : i + 1; }
      const delay = paused ? days : allowance.eased ? days / 2 : 0;
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
        due, soon: Math.max(0, day0 - due), days, pace, pile: !!(backlog || skipped),
        peak: { n: restPeak, day: restPeakDay, label: when(restPeakDay) },
        lessonsPaused: paused, lessonsEased: allowance.eased, planText,
        sessionTip: due >= 120 ? 50 : 0,
      };
    }

    return {
      sev, level: sev === 2 ? 'high' : sev === 1 ? 'watch' : 'ok', cap, warnings: W, recovery, allowance, forecast: fc,
      m: { due, next24, apprentice: app, lpd7, proj, safe, since, backlog, loadSev, appSev: loadSev, weekAvg: restAvg, lessonSev },
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
    if (a.paused) line += ' Your reviews are heavy right now, so this is a good place to stop for today.';
    else if (a.done >= a.allowed) line += a.eased
      ? ' With the reviews already scheduled for the coming days, that is about as much as fits today. The rest can wait until tomorrow.'
      : ` That meets today’s lesson goal (${a.goal}). The rest can wait until tomorrow.`;
    else line += ` About ${a.left} more would still fit today.`;
    return line;
  }

  /** What to say after a review session: good news when the pile is small, a nudge when it is not. */
  function afterReviews(res, before) {
    if (res.sev === 0) return before && before.sev >= 1 ? { good: true, text: 'Your reviews are back under control. Nice work.' } : null;
    const b = res.warnings.find((w) => w.id === 'backlog');
    if (b) return { good: false, text: `${n0(res.m.due)} reviews are still due. Another short session soon keeps it moving.` };
    return null;
  }

  root.Guard = { prefs, capacity, forecast, safeLessons, daysSinceReview, evaluate, visible, snooze, snoozed, toAnnounce, toPush, afterLessons, afterReviews, KEYS: K, DEFAULT_CAP };
})(typeof window !== 'undefined' ? window : globalThis);
