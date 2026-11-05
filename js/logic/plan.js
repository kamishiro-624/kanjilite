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
   *      acc (optional) -> your answer accuracy, 0..1 (85% when unknown) }
   * Returns the pace, the workload, a date for each level and `shape` (the weight of each level, to save with the plan).
   * If `end` is sooner than WaniKani allows, the numbers are for the fastest possible finish and `feasible` is false.
   */
  function make(o) {
    const { pos, target, end, now } = o;
    if (target - pos <= 0) return { done: true };
    const L0 = Math.floor(pos);
    const fastest = fastestDays(pos, target);
    const days = Math.max((end - now) / DAY, 0);
    const feasible = days >= fastest - 1e-9;
    const eff = Math.max(days, fastest);

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
    let t = 0;
    const milestones = shape.map((x, i) => { t += eff * cw[i] / cTotal; return { level: x.level + 1, date: now + t * DAY }; });

    const behind = Math.max(0, o.behind || 0); // e.g. level 12 vocabulary still in your lessons while you are on level 14
    const itemsLeft = full.reduce((s, L) => s + o.items(L), 0) + behind;
    const lpd = itemsLeft / Math.max(eff, 1);
    const acc = clampAcc(o.acc);
    const rev = simulate(lpd, eff, acc);
    return {
      done: false, feasible, days, fastest, earliest: now + fastest * DAY, scale: eff / fastest,
      perLevel: eff / (target - pos), fastestPerLevel: fastest / (target - pos),
      milestones, shape, itemsLeft, behind, lessonsPerDay: lpd, reviewsAvg: rev.avg, reviewsPeak: rev.peak, acc,
    };
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

  /** How far through the current level you are (0..1): kanji at Guru or above against the 90% needed to level up. */
  function levelFraction(subs, assignmentFor) {
    const kanji = subs.filter((x) => x.object === 'kanji' && !x.data.hidden_at);
    const need = Math.ceil(kanji.length * 0.9);
    if (!need) return 0;
    const done = kanji.filter((x) => { const a = assignmentFor(x.id); return a && a.data.srs_stage >= 5; }).length;
    return Math.min(1, done / need);
  }

  /** A saved plan against where you are now. state: done | late | behind | on | ahead. gap is in levels (negative = behind). */
  function evaluate(p, pos, now) {
    if (pos >= p.target) return { state: 'done' };
    const total = p.end - p.start;
    const f = total > 0 ? Math.min(1, Math.max(0, (now - p.start) / total)) : 1;
    const curve = curveOf(p);
    const W = weights(p.startPos, p.target, curve).reduce((a, b) => a + b.w, 0);
    const expected = posAtWork(p.startPos, p.target, f * W, curve);
    const gap = pos - expected;
    const daysLeft = (p.end - now) / DAY;
    return {
      state: now > p.end ? 'late' : gap <= -0.25 ? 'behind' : gap >= 0.25 ? 'ahead' : 'on',
      expected, gap, pos, target: p.target,
      plannedPerLevel: (total / DAY) / (p.target - p.startPos),
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

  root.Plan = { DEFAULT_ACC, DEFAULT_ITEMS, fastestDays, make, endForPeak, curveOf, shapeFields, reviewsPerDay, reviewsToday, levelFraction, evaluate, load, save, clear, dismissedToday, dismiss };
})(window);
