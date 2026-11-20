/* Level plan: pure maths plus the saved plan. No DOM, no network.

   A plan is "reach level T by date D". It is turned into a pace (days per level), a daily workload (new lessons
   and an estimate of the reviews they create), and a date for every level on the way. Levels are weighted by how
   quickly WaniKani allows them to be passed (levels 1 and 2 run twice as fast), so the schedule is the fastest
   possible one stretched to fit the time you give it. The same schedule is what the dashboard compares you with.

   The schedule is not a straight line. The date you pick sets the total time, but how that time is shared out over
   the levels follows your own pace (most people slow down as levels grow) and, once the levels are downloaded, how
   many items each level has. The shape is saved with the plan so the dashboard measures you against the same curve.
   The review estimate follows your answer accuracy: more mistakes mean more reviews. */
(function (root) {
  'use strict';

  const DAY = 24 * 3600 * 1000;
  const KEY = 'kl_plan';
  const DISMISS = 'kl_plan_dismissed';
  const DEFAULT_ITEMS = 150; // items per level when that level has not been downloaded yet (WaniKani averages about 150)
  const OFFSETS = [0.17, 0.5, 1.5, 3.5, 10.5, 24.5, 54.5, 174.5]; // days after a lesson at which its 8 reviews fall due, no mistakes
  const DEFAULT_ACC = 0.85; // answer accuracy assumed until yours is known
  const clampAcc = (a) => (Number.isFinite(a) ? Math.min(1, Math.max(0.5, a)) : DEFAULT_ACC);
  /** Reviews per scheduled review once mistakes are counted: every wrong answer sends an item back for another go. 85% -> 1.15. */
  const retryFactor = (acc) => 1 + (1 - clampAcc(acc));

  const FASTEST = Stats.paceFor([], 'fastest');
  const fast = (L) => FASTEST.byLevel(L).mean; // fewest days level L can take

  // A curve is a function level -> relative days for that level (the shape of the schedule). Without one, every
  // level is weighted by the fewest days it can take, which is the same for all levels except 1 and 2.
  const wt = (curve, L) => { const v = curve ? curve(L) : null; return v > 0 ? v : fast(L); };

  /** The levels still to climb from `pos` (level + how far through it, e.g. 12.4) to `target`, each with its weight. */
  function weights(pos, target, curve) {
    const out = [];
    const L0 = Math.floor(pos), f = pos - L0;
    for (let L = L0; L < target; L++) out.push({ level: L, w: wt(curve, L) * (L === L0 ? 1 - f : 1) });
    return out;
  }
  const fastestDays = (pos, target) => weights(pos, target).reduce((s, x) => s + x.w, 0);

  /** Where a schedule with this curve would be after `work` units of its weight, starting at `pos`. */
  function posAtWork(pos, target, work, curve) {
    let L = Math.floor(pos), f = pos - L, left = work;
    while (L < target) {
      const w = wt(curve, L), rem = w * (1 - f);
      if (left < rem) return L + f + left / w;
      left -= rem; L++; f = 0;
    }
    return target;
  }

  /** Reviews per day that `lpd` new lessons a day create over `days` days (new items only), at this answer accuracy. */
  function simulate(lpd, days, acc) {
    const k = retryFactor(acc);
    const n = Math.max(1, Math.min(2200, Math.ceil(days)));
    const r = new Array(n).fill(0);
    for (let j = 0; j < n; j++) OFFSETS.forEach((o) => { const d = Math.floor(j + o); if (d < n) r[d] += lpd * k; });
    const avg = r.reduce((a, b) => a + b, 0) / n;
    let peak = 0;
    for (let i = 0; i + 7 <= n; i++) { let s = 0; for (let k2 = 0; k2 < 7; k2++) s += r[i + k2]; peak = Math.max(peak, s / 7); }
    return { avg, peak: n < 7 ? avg : peak };
  }

  /**
   * o: { pos, target, end (ms), now (ms), items(level) -> items still to learn on that level,
   *      behind (optional) -> items still to learn on levels below `pos` (lessons left over from earlier levels),
   *      curve (optional) -> relative days for a level, e.g. your own pace, which sets how the time is shared out,
   *      bySize (optional) -> true once the item counts are exact: bigger levels then get proportionally more time,
   *      acc (optional) -> your answer accuracy, 0..1 (85% when unknown),
   *      reserve (optional) -> days set aside at the start for a backlog of lessons from earlier levels }
   * Returns the pace, the workload, a date for each level and `shape` (the weight of each level, to save with the plan).
   * If `end` is sooner than WaniKani allows, the numbers are for the fastest possible finish and `feasible` is false.
   */
  function make(o) {
    const { pos, target, end, now } = o;
    if (target - pos <= 0) return { done: true };
    const L0 = Math.floor(pos);
    // reserve: days set aside at the start for a backlog of lessons from earlier levels (a one-time cost, not a pace).
    // They come off the front of the time you give; the levels are then fitted into what is left.
    const R = Math.max(0, o.reserve || 0);
    const fastest = fastestDays(pos, target);
    const days = Math.max((end - now) / DAY, 0);
    const feasible = days >= fastest + R - 1e-9;
    const eff = Math.max(days, fastest + R);
    const span = eff - R;

    // The shape: your own pace per level, nudged by how big each level is (damped, so a 20% bigger level gets about
    // 10% more time). The current level keeps a factor of 1 because its item count is only what is left of it.
    const full = [];
    for (let L = L0; L < target; L++) full.push(L);
    const sizes = full.filter((L) => L > L0).map((L) => o.items(L));
    const avg = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
    const load = (L) => (o.bySize && avg > 0 && L > L0 ? Math.min(1.35, Math.max(0.75, Math.sqrt(o.items(L) / avg))) : 1);
    const shape = full.map((L) => ({ level: L, w: wt(o.curve, L) * load(L) }));
    const cw = shape.map((x) => x.w * (x.level === L0 ? 1 - (pos - L0) : 1));
    const cTotal = cw.reduce((a, b) => a + b, 0);
    let t = R;
    const milestones = shape.map((x, i) => { t += span * cw[i] / cTotal; return { level: x.level + 1, date: now + t * DAY }; });

    const behind = Math.max(0, o.behind || 0); // e.g. level 12 vocabulary still in your lessons while you are on level 14
    const itemsLeft = full.reduce((s, L) => s + o.items(L), 0) + behind;
    const lpd = itemsLeft / Math.max(eff, 1);
    const acc = clampAcc(o.acc);
    const rev = simulate(lpd, eff, acc);
    return {
      done: false, feasible, days, fastest, earliest: now + (fastest + R) * DAY, scale: span / fastest, reserve: R,
      perLevel: span / (target - pos), fastestPerLevel: fastest / (target - pos),
      milestones, shape, itemsLeft, behind, lessonsPerDay: lpd, reviewsAvg: rev.avg, reviewsPeak: rev.peak, acc,
    };
  }

  /**
   * A lesson is owed once it has been available longer than this. A level-up (or kanji reaching Guru) unlocks a burst
   * of new lessons at once, and those are the plan's normal work, not a backlog, so what counts is how long a lesson has
   * actually waited, not how many are in the queue. Radicals, kanji and vocabulary all count the same.
   */
  const OWED_AFTER_DAYS = 3;
  /** Owed lessons: those from earlier levels plus those on your current level, each already past OWED_AFTER_DAYS. */
  function owed(previous, current) {
    return Math.max(0, previous || 0) + Math.max(0, current || 0);
  }

  /** Reviews a day that `lpd` new lessons a day create over a plan of `days` days at this accuracy (for the live figure). */
  function reviewsPerDay(lpd, days, acc) { return simulate(lpd, days, acc).avg; }

  /**
   * The earliest end date whose busiest weeks stay within `ceiling` reviews a day. mk(end) must return a Plan.make result.
   * Searches between `lo` (the earliest possible date) and `hi`; returns null if even `hi` is too heavy.
   * More time means fewer lessons a day, so the busiest week only ever gets lighter as the date moves back.
   */
  function endForPeak(mk, ceiling, lo, hi) {
    if (mk(lo).reviewsPeak <= ceiling) return lo;
    if (mk(hi).reviewsPeak > ceiling) return null;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (mk(mid).reviewsPeak <= ceiling) hi = mid; else lo = mid; }
    return hi;
  }

  /** The curve a saved plan was made with, or null for plans saved before curves existed (those use the fastest weights). */
  function curveOf(p) {
    return p && Array.isArray(p.w) && p.w.length && Number.isFinite(p.w0) ? (L) => p.w[L - p.w0] : null;
  }
  /** The saved form of a made plan's shape: the weight of each level, one decimal place, from the level you were on. */
  const shapeFields = (made) => ({ w0: made.shape[0].level, w: made.shape.map((x) => Math.round(x.w * 10) / 10) });

  // Hours an item waits at each stage before its review (WaniKani's standard intervals). An item at Apprentice I
  // needs 4 + 8 + 23 + 47 hours of waiting, with a correct answer at the end of each, to reach Guru I.
  const WAIT_H = { 1: 4, 2: 8, 3: 23, 4: 47 };
  const HOUR = 3600 * 1000;
  const PATH_H = WAIT_H[1] + WAIT_H[2] + WAIT_H[3] + WAIT_H[4]; // 82 hours from a fresh lesson to Guru
  const waitAfter = (stage) => { let h = 0; for (let k = stage + 1; k <= 4; k++) h += WAIT_H[k]; return h; };

  /**
   * Where the current level stands. The kanji at Guru or above against the 90% needed to level up, plus partial credit
   * for kanji on their way (so one at Apprentice IV, a single review from Guru, counts for much more than one that has
   * just been started), and the earliest date the level can be passed.
   *
   * The earliest date follows every kanji through its real schedule: it waits for its review (available_at), is assumed
   * to be answered correctly, and waits for the next interval, until it reaches Guru. The level-up comes when the
   * `need`-th kanji gets there. Kanji not started yet are assumed to be started now; kanji still locked have no known
   * date, and if too few dates are known `eta` is null. `exact` is false when the date leans on kanji not started yet.
   * Returns { need, done, total, fraction (0..1), eta (ms or null), exact, ready }.
   */
  function levelStatus(subs, assignmentFor, now) {
    now = now == null ? Date.now() : now;
    const kanji = subs.filter((x) => x.object === 'kanji' && !x.data.hidden_at);
    const need = Math.ceil(kanji.length * 0.9);
    if (!need) return { need: 0, done: 0, total: kanji.length, fraction: 0, eta: null, exact: true, ready: false };
    let done = 0, credit = 0;
    const etas = []; // [ms, started]
    kanji.forEach((x) => {
      const a = assignmentFor(x.id), d = a && a.data;
      const stage = d && d.started_at ? d.srs_stage : 0;
      if (stage >= 5) { done++; credit += 1; return; }
      if (stage >= 1) {
        const due = d.available_at ? Date.parse(d.available_at) : now;
        const wait = Math.max(0, (Number.isFinite(due) ? due : now) - now);
        const remaining = wait + waitAfter(stage) * HOUR; // ms until it can be at Guru
        credit += Math.min(1, Math.max(0, 1 - remaining / (PATH_H * HOUR)));
        etas.push([now + remaining, true]);
      } else if (d && d.unlocked_at) {
        etas.push([now + PATH_H * HOUR, false]); // unlocked, lesson not done yet
      } // else: still locked, no date
    });
    const fraction = Math.min(1, credit / need);
    const stillNeeded = need - done;
    let eta = null, exact = true;
    if (stillNeeded <= 0) eta = now;
    else {
      etas.sort((p, q) => p[0] - q[0]);
      if (etas.length >= stillNeeded) {
        const pick = etas.slice(0, stillNeeded);
        eta = pick[pick.length - 1][0];
        exact = pick.every((e) => e[1]);
      }
    }
    return { need, done, total: kanji.length, fraction, eta, exact, ready: stillNeeded <= 0 };
  }

  /** How far through the current level you are (0..1), counting kanji on their way to Guru in part. */
  function levelFraction(subs, assignmentFor) { return levelStatus(subs, assignmentFor, Date.now()).fraction; }

  /** The days a saved plan gives level L (its whole span, whatever the pace so far), or null when L is not in the plan. */
  function daysFor(p, L) {
    const curve = curveOf(p);
    if (L < Math.floor(p.startPos) || L >= p.target) return null;
    const W = weights(p.startPos, p.target, curve).reduce((a, b) => a + b.w, 0);
    const R = p.reserve || 0; // days set aside at the start for a backlog; they belong to the first level
    return W > 0 ? wt(curve, L) * ((p.end - p.start) / DAY - R) / W + (L === Math.floor(p.startPos) ? R : 0) : null;
  }

  /** The dates a saved plan gives for each level on the way: [{ level, date }] (the date you are meant to reach that level). */
  function scheduleOf(p) {
    const ws = weights(p.startPos, p.target, curveOf(p));
    const W = ws.reduce((a, b) => a + b.w, 0);
    const R = (p.reserve || 0) * DAY;
    let t = 0;
    return ws.map((x) => { t += x.w; return { level: x.level + 1, date: p.start + R + (W > 0 ? (p.end - p.start - R) * t / W : 0) }; });
  }

  /**
   * Is the plan realistic at your own pace? est is a Stats.estimate for the plan's target (it has a quicker and a slower
   * range). 'ok': your usual pace gets there in time. 'tight': only the quicker end of your range does. 'unrealistic':
   * not even that. lateDays is how long after the date your usual pace would arrive (negative = before); ratio is how
   * many times longer your usual pace takes than the time you have. null without an estimate.
   */
  function outlook(p, est) {
    if (!est || est.already || !p || !p.end) return null;
    const late = (est.date - p.end) / DAY, lateLow = (est.dateLow - p.end) / DAY;
    const have = Math.max(1, (p.end - est.now) / DAY);
    return { risk: late <= 0 ? 'ok' : lateLow <= 0 ? 'tight' : 'unrealistic', lateDays: late, ratio: est.days / have, date: est.date };
  }

  /**
   * A saved plan against where you are now. state: done | late | behind | catchup | on | ahead.
   * Behind or ahead is measured in days (a level's worth of time is different for every plan): the gap from the curve,
   * and a look forward at the earliest date the current level can be passed against the date the plan gives it.
   * ctx (all optional): { eta (ms, earliest level-up, from levelStatus), etaExact, backlog (lessons of every kind, radicals, kanji
   * and vocabulary, waiting from earlier levels), current (lessons waiting on your current level), est (a Stats.estimate for the plan's target, for the outlook) }. A backlog explains some lateness: while
   * it is being worked through and accounts for all of it, the state is 'catchup' rather than 'behind'.
   */
  function evaluate(p, pos, now, ctx) {
    ctx = ctx || {};
    if (pos >= p.target) return { state: 'done' };
    const total = p.end - p.start;
    const R = (p.reserve || 0) * DAY;          // time the plan set aside for a backlog before the levels begin
    const workSpan = total - R;
    const f = workSpan > 0 ? Math.min(1, Math.max(0, (now - p.start - R) / workSpan)) : 1;
    const curve = curveOf(p);
    const W = weights(p.startPos, p.target, curve).reduce((a, b) => a + b.w, 0);
    const expected = posAtWork(p.startPos, p.target, f * W, curve);
    const gap = pos - expected;
    const daysLeft = (p.end - now) / DAY;
    const plannedPerLevel = (workSpan / DAY) / (p.target - p.startPos);
    const perWork = W > 0 ? (workSpan / DAY) / W : 0;
    const done = W - weights(Math.max(pos, p.startPos), p.target, curve).reduce((a, b) => a + b.w, 0);
    const rawGap = (done - f * W) * perWork; // negative = behind the curve, counting levels only

    const nextLevel = Math.floor(pos) + 1;
    const m = scheduleOf(p).find((x) => x.level === nextLevel);
    const plannedNext = m ? m.date : null;
    const slipDays = ctx.eta != null && plannedNext != null ? (ctx.eta - plannedNext) / DAY : null;
    // Only backlog beyond what the plan already set aside explains lateness; the reserved days are in the schedule.
    const owedNow = p.lpd ? owed(ctx.backlog, ctx.current) : 0; // lessons (any kind, any level) that have waited past OWED_AFTER_DAYS
    const backlogDays = owedNow > 0 ? Math.max(0, owedNow / p.lpd - (p.reserve || 0)) : 0;
    // Levels are passed on kanji alone, but the plan counts every kind of lesson. Radicals, kanji and vocabulary left
    // waiting beyond the reserve are time still owed, so they take away from being ahead (you can't be ahead by
    // skipping vocabulary). Being behind is left as measured: a backlog already slows the kanji it competes with.
    const gapDays = rawGap > 0 ? rawGap - backlogDays : rawGap;
    const behindDays = Math.max(-gapDays, slipDays != null ? slipDays : -Infinity);
    const thr = Math.max(2, 0.2 * plannedPerLevel);

    let state;
    if (now > p.end) state = 'late';
    else if (behindDays >= thr) state = behindDays - backlogDays < thr ? 'catchup' : 'behind';
    else if (gapDays >= thr) state = 'ahead';
    else state = 'on';
    return {
      state, expected, gap, gapDays, levelGapDays: rawGap, behindDays, thr, pos, target: p.target,
      reason: slipDays != null && slipDays > -gapDays ? 'forecast' : 'position',
      eta: ctx.eta != null ? ctx.eta : null, etaExact: ctx.etaExact !== false, plannedNext, nextLevel, slipDays,
      backlog: owedNow, backlogDays, backlogCleared: !(owedNow > 0) && (p.reserve || 0) > 0,
      outlook: outlook(p, ctx.est),
      plannedPerLevel,
      neededPerLevel: daysLeft > 0 ? daysLeft / (p.target - pos) : null,
      impossible: daysLeft < fastestDays(pos, p.target),
      earliest: now + fastestDays(pos, p.target) * DAY,
    };
  }

  // ---- the saved plan (one per browser, tied to the account that made it) ----
  function load(uid) {
    try { const p = JSON.parse(localStorage.getItem(KEY)); return p && p.v === 1 && p.uid === uid && p.target && p.end ? p : null; } catch (e) { return null; }
  }
  function save(uid, p) {
    try { localStorage.setItem(KEY, JSON.stringify(Object.assign({ v: 1, uid }, p))); localStorage.removeItem(DISMISS); } catch (e) { /* storage blocked */ }
  }
  /**
   * Replace the saved plan with a changed one, keeping its history. The new plan is measured from today, so what it
   * took from the old plan is written down rather than lost: `origin` is the first version ever saved and `revs` lists
   * every change with how far ahead or behind the old plan you were at that moment (gapDays, negative = behind).
   * made: the new plan's own fields; meta: { pos, gapDays }.
   */
  function revise(uid, old, made, meta) {
    const origin = old.origin || { start: old.start, startPos: old.startPos, end: old.end, target: old.target };
    const revs = (old.revs || []).concat([{
      at: made.start, fromEnd: old.end, toEnd: made.end, fromTarget: old.target, toTarget: made.target,
      pos: meta && meta.pos != null ? Math.round(meta.pos * 100) / 100 : null,
      gapDays: meta && meta.gapDays != null ? Math.round(meta.gapDays * 10) / 10 : null,
    }]).slice(-20);
    const next = Object.assign({}, made, { origin, revs, rev: (old.rev || 0) + 1 });
    save(uid, next);
    return next;
  }
  /** How the saved plan has moved since it was first saved: { days (its end date, later = positive), levels (target change), n (changes) }. */
  function drift(p) {
    const o = p && p.origin;
    return { n: p && p.rev ? p.rev : 0, days: o ? (p.end - o.end) / DAY : 0, levels: o ? p.target - o.target : 0, origin: o || null };
  }
  const clear = () => { try { localStorage.removeItem(KEY); localStorage.removeItem(DISMISS); } catch (e) { /* ignore */ } };
  const today = () => Stats.dayKey(new Date());
  const dismissedToday = () => { try { return localStorage.getItem(DISMISS) === today(); } catch (e) { return false; } };
  const dismiss = () => { try { localStorage.setItem(DISMISS, today()); } catch (e) { /* ignore */ } };

  // ---- today's review total, fixed for the day ----
  // The number of reviews a day is "done + still to do today". Counting new ones as they fall due made the bar move
  // back and forth, so the total is worked out once a day (from reviews already done and everything due before
  // midnight) and kept. Reviews that appear later (lessons you do today, answers you get wrong) just carry the bar
  // past 100%. `canLock` is false until the saved copy has been brought up to date, so a stale copy isn't locked in.
  const TOTAL = 'kl_day_total';
  function reviewsToday(done, remaining, canLock) {
    const k = today();
    try { const s = JSON.parse(localStorage.getItem(TOTAL)); if (s && s.day === k && s.total >= 0) return { total: s.total, done, over: Math.max(0, done - s.total) }; } catch (e) { /* none saved */ }
    const total = done + remaining;
    if (canLock) { try { localStorage.setItem(TOTAL, JSON.stringify({ day: k, total })); } catch (e) { /* storage blocked */ } }
    return { total, done, over: Math.max(0, done - total) };
  }

  root.Plan = { owed, OWED_AFTER_DAYS, DEFAULT_ACC, DEFAULT_ITEMS, fastestDays, make, endForPeak, curveOf, shapeFields, reviewsPerDay, reviewsToday, levelFraction, levelStatus, daysFor, scheduleOf, outlook, evaluate, load, save, revise, drift, clear, dismissedToday, dismiss };
})(window);
