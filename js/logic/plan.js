/* Level plan: pure maths plus the saved plan. No DOM, no network.

   A plan is "reach level T by date D". It is turned into a pace (days per level), a daily workload (new lessons
   and an estimate of the reviews they create), and a date for every level on the way. Levels are weighted by how
   quickly WaniKani allows them to be passed (levels 1 and 2 run twice as fast), so the schedule is the fastest
   possible one stretched to fit the time you give it. The same schedule is what the dashboard compares you with. */
(function (root) {
  'use strict';

  const DAY = 24 * 3600 * 1000;
  const KEY = 'kl_plan';
  const DISMISS = 'kl_plan_dismissed';
  const DEFAULT_ITEMS = 150; // items per level when that level has not been downloaded yet (WaniKani averages about 150)
  const OFFSETS = [0.17, 0.5, 1.5, 3.5, 10.5, 24.5, 54.5, 174.5]; // days after a lesson at which its 8 reviews fall due, no mistakes
  const MISTAKES = 1.15; // extra reviews for answers you get wrong (about 85% correct)

  const FASTEST = Stats.paceFor([], 'fastest');
  const fast = (L) => FASTEST.byLevel(L).mean; // fewest days level L can take

  /** The levels still to climb from `pos` (level + how far through it, e.g. 12.4) to `target`, each with its weight. */
  function weights(pos, target) {
    const out = [];
    const L0 = Math.floor(pos), f = pos - L0;
    for (let L = L0; L < target; L++) out.push({ level: L, w: fast(L) * (L === L0 ? 1 - f : 1) });
    return out;
  }
  const fastestDays = (pos, target) => weights(pos, target).reduce((s, x) => s + x.w, 0);

  /** Where the fastest schedule would be after `work` days of fastest-pace progress, starting at `pos`. */
  function posAtWork(pos, target, work) {
    let L = Math.floor(pos), f = pos - L, left = work;
    while (L < target) {
      const w = fast(L), rem = w * (1 - f);
      if (left < rem) return L + f + left / w;
      left -= rem; L++; f = 0;
    }
    return target;
  }

  /** Reviews per day that `lpd` new lessons a day create over `days` days (new items only). */
  function simulate(lpd, days) {
    const n = Math.max(1, Math.min(2200, Math.ceil(days)));
    const r = new Array(n).fill(0);
    for (let j = 0; j < n; j++) OFFSETS.forEach((o) => { const d = Math.floor(j + o); if (d < n) r[d] += lpd * MISTAKES; });
    const avg = r.reduce((a, b) => a + b, 0) / n;
    let peak = 0;
    for (let i = 0; i + 7 <= n; i++) { let s = 0; for (let k = 0; k < 7; k++) s += r[i + k]; peak = Math.max(peak, s / 7); }
    return { avg, peak: n < 7 ? avg : peak };
  }

  /**
   * o: { pos, target, end (ms), now (ms), items(level) -> items still to learn on that level }
   * Returns the pace, the workload and a date for each level. If `end` is sooner than WaniKani allows, the numbers
   * are for the fastest possible finish and `feasible` is false.
   */
  function make(o) {
    const { pos, target, end, now } = o;
    if (target - pos <= 0) return { done: true };
    const ws = weights(pos, target);
    const fastest = ws.reduce((s, x) => s + x.w, 0);
    const days = Math.max((end - now) / DAY, 0);
    const feasible = days >= fastest - 1e-9;
    const eff = Math.max(days, fastest);
    let t = 0;
    const milestones = ws.map((x) => { t += eff * x.w / fastest; return { level: x.level + 1, date: now + t * DAY }; });
    const itemsLeft = ws.reduce((s, x) => s + o.items(x.level), 0);
    const lpd = itemsLeft / Math.max(eff, 1);
    const rev = simulate(lpd, eff);
    return {
      done: false, feasible, days, fastest, earliest: now + fastest * DAY, scale: eff / fastest,
      perLevel: eff / (target - pos), fastestPerLevel: fastest / (target - pos),
      milestones, itemsLeft, lessonsPerDay: lpd, reviewsAvg: rev.avg, reviewsPeak: rev.peak,
    };
  }

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
    const expected = posAtWork(p.startPos, p.target, f * fastestDays(p.startPos, p.target));
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

  root.Plan = { DEFAULT_ITEMS, fastestDays, make, levelFraction, evaluate, load, save, clear, dismissedToday, dismiss };
})(window);
