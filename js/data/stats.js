/* Numbers behind the Stats screen: how fast you have been levelling, review statistics, and a day-by-day
   review history. Everything is cached in the browser (IndexedDB, the same `meta` store the rest of the app
   uses), so reopening the screen costs at most a request or two.

   - Level history:      GET /level_progressions (one small request, refreshed every few minutes)
   - Review statistics:  GET /review_statistics, then only what changed (`updated_after`)
   - Review history:     WaniKani no longer provides it (GET /reviews is always empty), so reviews finished in this
                         app are recorded as per-day totals, starting from the first one.

   The maths (pace, estimates, bucketing) is plain functions at the bottom of the file. */
(function (root) {
  'use strict';

  const DAY = 24 * 3600 * 1000;
  const LP_KEY = 'stats_lp';
  const RS_KEY = 'stats_rs';
  const REV_KEY = 'stats_rev';
  const FAST_EARLY = 3.5; // days per level at the shortest SRS intervals; levels 1 and 2 run twice as fast
  const FAST_NORMAL = 6.9;

  const ms = (s) => (s ? Date.parse(s) : null);
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const keyToDate = (k) => { const p = k.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); };
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : 0);

  // ---------------------------------------------------------------- saved copies

  let uid = null;     // whose data is in memory
  const mem = {};     // key -> saved value, once read

  async function readSaved(key) {
    if (!(key in mem)) {
      const rows = await api.db.getMany('meta', [key]);
      mem[key] = rows.length ? rows[0].value : null;
    }
    const v = mem[key];
    return v && v.uid === uid ? v : null;
  }
  function writeSaved(key, value) {
    value.uid = uid;
    mem[key] = value;
    return api.db.put('meta', [{ key, value }]);
  }

  // ---------------------------------------------------------------- level history

  function normalizeProgressions(items) {
    const byLevel = new Map();
    items.forEach((x) => {
      const d = x.data;
      if (d.abandoned_at) return; // a level that was reset away
      const row = { level: d.level, unlocked: ms(d.unlocked_at), started: ms(d.started_at), passed: ms(d.passed_at), completed: ms(d.completed_at) };
      const old = byLevel.get(d.level);
      if (!old || (row.unlocked || 0) >= (old.unlocked || 0)) byLevel.set(d.level, row);
    });
    return [...byLevel.values()].sort((a, b) => a.level - b.level);
  }

  /** The saved level history ({ at, rows }), if any, without touching the network. */
  async function savedProgressions() {
    return readSaved(LP_KEY); // { at, rows } or null
  }

  /** Fetch the level history from WaniKani and save it. */
  async function fetchProgressions(opts) {
    const items = await api.list('/level_progressions', { background: !!(opts && opts.background) });
    const rows = normalizeProgressions(items);
    await writeSaved(LP_KEY, { at: Date.now(), rows });
    return rows;
  }

  // ---------------------------------------------------------------- review statistics

  const TYPE_CODE = { radical: 0, kanji: 1, vocabulary: 2, kana_vocabulary: 3 };

  /** Per-item answer counts. Rows are [type, meaning right, meaning wrong, reading right, reading wrong]. */
  async function savedReviewStats() {
    return readSaved(RS_KEY);
  }

  async function syncReviewStats(opts) {
    const o = opts || {};
    let saved = await readSaved(RS_KEY);
    if (saved && !o.force && Date.now() - saved.at < (o.maxAge == null ? 30 * 60000 : o.maxAge)) return saved;
    const since = saved && saved.since;
    const path = '/review_statistics' + (since ? '?updated_after=' + encodeURIComponent(since) : '');
    const rows = saved ? Object.assign({}, saved.rows) : {};
    let seen = 0;
    const items = await api.list(path, {
      background: o.background !== false,
      onPage: (page) => { seen += page.length; if (o.onProgress) o.onProgress(seen); },
    });
    items.forEach((x) => {
      const d = x.data;
      if (d.hidden) { delete rows[d.subject_id]; return; }
      rows[d.subject_id] = [TYPE_CODE[d.subject_type] || 0, d.meaning_correct || 0, d.meaning_incorrect || 0, d.reading_correct || 0, d.reading_incorrect || 0];
    });
    saved = { at: Date.now(), since: items.dataUpdatedAt || (saved && saved.since) || null, rows };
    await writeSaved(RS_KEY, saved);
    return saved;
  }

  /** Accuracy by kind of question and by kind of item, plus the items you miss most. */
  function summarizeReviewStats(rows) {
    const out = {
      items: 0,
      meaning: { c: 0, i: 0 }, reading: { c: 0, i: 0 },
      byType: { radical: { items: 0, c: 0, i: 0 }, kanji: { items: 0, c: 0, i: 0 }, vocabulary: { items: 0, c: 0, i: 0 } },
      hard: [],
    };
    const names = ['radical', 'kanji', 'vocabulary', 'vocabulary'];
    const hard = [];
    Object.keys(rows).forEach((id) => {
      const r = rows[id];
      const total = r[1] + r[2] + r[3] + r[4];
      if (!total) return;
      out.items++;
      out.meaning.c += r[1]; out.meaning.i += r[2];
      out.reading.c += r[3]; out.reading.i += r[4];
      const t = out.byType[names[r[0]]];
      t.items++; t.c += r[1] + r[3]; t.i += r[2] + r[4];
      if (total >= 6 && r[2] + r[4] > 0) hard.push({ id: Number(id), type: names[r[0]], pct: (r[1] + r[3]) / total * 100, wrong: r[2] + r[4], total });
    });
    hard.sort((a, b) => a.pct - b.pct || b.wrong - a.wrong);
    out.hard = hard.slice(0, 12);
    out.answers = { c: out.meaning.c + out.reading.c, i: out.meaning.i + out.reading.i };
    return out;
  }

  // ---------------------------------------------------------------- review history (per-day totals)

  function emptyHistory() {
    return { last: 0, n: 0, first: null, total: null, days: {}, hours: Array.from({ length: 24 }, () => [0, 0]), at: 0 };
  }

  /** Fold a page of reviews into the totals. Day rows are [reviews, without a mistake, wrong meaning, wrong reading, moved up, moved down]. */
  function addReviews(h, items) {
    items.forEach((it) => {
      const d = it.data;
      const ts = Date.parse(d.created_at);
      if (!Number.isFinite(ts)) return;
      const dt = new Date(ts);
      const key = dayKey(dt);
      const row = h.days[key] || (h.days[key] = [0, 0, 0, 0, 0, 0]);
      const im = d.incorrect_meaning_answers || 0;
      const ir = d.incorrect_reading_answers || 0;
      row[0]++;
      if (!im && !ir) row[1]++;
      row[2] += im; row[3] += ir;
      if (d.ending_srs_stage > d.starting_srs_stage) row[4]++;
      else if (d.ending_srs_stage < d.starting_srs_stage) row[5]++;
      const hr = h.hours[dt.getHours()];
      hr[0]++;
      if (!im && !ir) hr[1]++;
      h.n++;
      if (it.id > h.last) h.last = it.id;
      if (h.first === null || ts < h.first) h.first = ts;
    });
  }

  async function savedHistory() {
    return readSaved(REV_KEY);
  }

  /**
   * WaniKani no longer keeps individual reviews: GET /reviews always answers with an empty list, so there is nothing
   * to download. Instead every review finished in this app is folded into the same per-day totals as it happens
   * (a review's wrong answers and the SRS stage it moved from and to), so the review graphs fill in from now on.
   */
  let recording = Promise.resolve();
  function recordReview(r, now) {
    recording = recording.then(async () => {
      const h = (await readSaved(REV_KEY)) || emptyHistory();
      addReviews(h, [{ id: 0, data: {
        created_at: new Date(now || Date.now()).toISOString(),
        incorrect_meaning_answers: r.im || 0, incorrect_reading_answers: r.ir || 0,
        starting_srs_stage: r.from || 0, ending_srs_stage: r.to || 0,
      } }]);
      h.at = Date.now();
      await writeSaved(REV_KEY, h);
    }).catch(() => { /* storage unavailable: the streak still works from the simple daily counts */ });
    return recording;
  }

  // ---------------------------------------------------------------- time series

  const startOfBucket = (d, bucket) => {
    if (bucket === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    if (bucket === 'month') return new Date(d.getFullYear(), d.getMonth(), 1);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const nextBucket = (d, bucket) => {
    if (bucket === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
    if (bucket === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  };

  /** Group per-day rows into days, weeks or months. fill: add empty buckets between the first and the last. */
  function bucketDays(days, bucket, fill) {
    const map = new Map();
    Object.keys(days).forEach((k) => {
      const b = startOfBucket(keyToDate(k), bucket).getTime();
      const acc = map.get(b) || [0, 0, 0, 0, 0, 0];
      days[k].forEach((v, i) => { acc[i] += v; });
      map.set(b, acc);
    });
    const keys = [...map.keys()].sort((a, b) => a - b);
    if (!keys.length) return [];
    const out = [];
    if (fill) {
      for (let d = new Date(keys[0]); d.getTime() <= keys[keys.length - 1]; d = nextBucket(d, bucket)) {
        out.push({ t: d.getTime(), v: map.get(d.getTime()) || [0, 0, 0, 0, 0, 0] });
      }
    } else keys.forEach((t) => out.push({ t, v: map.get(t) }));
    return out;
  }

  /** Count timestamps per day, week or month (for lessons started). Returns the same shape as bucketDays, in slot 0. */
  function bucketTimes(times, bucket) {
    const days = {};
    times.forEach((t) => {
      const k = dayKey(new Date(t));
      (days[k] || (days[k] = [0, 0, 0, 0, 0, 0]))[0]++;
    });
    return bucketDays(days, bucket, true);
  }


  // ---------------------------------------------------------------- reviews done in this app, and streaks

  const LOCAL_DAYS = 'kl_rev_days';
  const readLocalDays = () => { try { return JSON.parse(localStorage.getItem(LOCAL_DAYS) || '{}') || {}; } catch (e) { return {}; } };

  /** Count one finished review on today's date. details: { im, ir, from, to } also feeds the review graphs. */
  function noteReview(now, details) {
    if (details) recordReview(details, now);
    try {
      const d = readLocalDays();
      const t = now || Date.now();
      const k = dayKey(new Date(t));
      d[k] = (d[k] || 0) + 1;
      const cutoff = dayKey(new Date(t - 420 * DAY));
      Object.keys(d).forEach((x) => { if (x < cutoff) delete d[x]; });
      localStorage.setItem(LOCAL_DAYS, JSON.stringify(d));
    } catch (e) { /* storage unavailable: no streak from local counts */ }
  }

  /** Reviews per day, from the downloaded history and from what this app has counted itself (the larger number wins). */
  function dayCounts(history) {
    const out = {};
    if (history && history.days) Object.keys(history.days).forEach((k) => { out[k] = history.days[k][0]; });
    const local = readLocalDays();
    Object.keys(local).forEach((k) => { out[k] = Math.max(out[k] || 0, local[k]); });
    return out;
  }

  /**
   * Days in a row with at least one review. A streak is still alive on a day you have not reviewed yet,
   * so it counts back from yesterday until you review today.
   */
  function streakInfo(counts, now) {
    const t = now || Date.now();
    const today = new Date(t);
    const key = (d) => dayKey(d);
    const prevDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    const has = (d) => (counts[key(d)] || 0) > 0;
    let d = has(today) ? today : prevDay(today);
    let current = 0;
    while (has(d)) { current++; d = prevDay(d); }
    const keys = Object.keys(counts).filter((k) => counts[k] > 0).sort();
    let best = 0, run = 0, prev = null;
    keys.forEach((k) => {
      const dt = keyToDate(k);
      run = prev && key(prevDay(dt)) === prev ? run + 1 : 1;
      prev = k;
      if (run > best) best = run;
    });
    return { current, best, active: keys.length, today: counts[key(today)] || 0, doneToday: has(today) };
  }

  /** Items under a score, worst first. rows are the review-statistics rows; ok(id) says whether an item still counts. */
  function criticalItems(rows, ok, opts) {
    const o = Object.assign({ below: 75, minAnswers: 4, limit: 100 }, opts || {});
    const out = [];
    Object.keys(rows).forEach((id) => {
      const r = rows[id];
      const total = r[1] + r[2] + r[3] + r[4];
      if (total < o.minAnswers || !ok(Number(id))) return;
      const p = (r[1] + r[3]) / total * 100;
      if (p < o.below) out.push({ id: Number(id), pct: p, wrong: r[2] + r[4], total });
    });
    out.sort((a, b) => a.pct - b.pct || b.wrong - a.wrong);
    return { count: out.length, items: out.slice(0, o.limit) };
  }

  // ---------------------------------------------------------------- pace and estimates

  /** Finished levels (days from unlocking to passing) and how long the current level has been going. */
  function levelStats(rows, level, now) {
    const done = [];
    rows.forEach((r) => {
      if (!r.passed || !r.unlocked || r.passed < r.unlocked || r.level >= level) return;
      done.push({ level: r.level, days: (r.passed - r.unlocked) / DAY, unlocked: r.unlocked, passed: r.passed });
    });
    done.sort((a, b) => a.level - b.level);
    const cur = rows.find((r) => r.level === level);
    let since = cur && (cur.unlocked || cur.started);
    if (!since && done.length) since = done[done.length - 1].passed;
    const lastPassed = rows.filter((r) => r.passed).map((r) => r.passed);
    return {
      done,
      since: since || null,
      elapsedDays: since ? Math.max(0, (now - since) / DAY) : 0,
      reachedAt: (L) => { const r = rows.find((x) => x.level === L); return r ? (r.unlocked || r.started || null) : null; },
      lastPassed: lastPassed.length ? Math.max.apply(null, lastPassed) : null,
    };
  }

  const fastestFor = (L) => (L <= 2 ? FAST_EARLY : FAST_NORMAL);

  // ---- robust statistics: one very long (or very short) level must not move the pace

  /** Value at quantile q (0..1) of an ascending list, interpolating between neighbours. */
  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  const asc = (a) => a.slice().sort((x, y) => x - y);
  const median = (a) => quantile(asc(a), 0.5);

  /**
   * Pull values that are far outside the rest in to a fence, rather than throwing them away: a 70-day level
   * (a holiday, an illness) still counts as "a slow level", but only as much as a long one would. Needs at least
   * three values to tell; with fewer, nothing is changed.
   */
  function tame(values) {
    const sorted = asc(values);
    const med = quantile(sorted, 0.5);
    if (sorted.length < 3) return { values: values.slice(), clipped: 0, median: med };
    let hi, lo;
    if (sorted.length < 5) { hi = med * 1.75; lo = med / 1.75; }
    else {
      const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75), iqr = q3 - q1;
      hi = Math.max(q3 + 1.5 * iqr, med * 1.25);
      lo = Math.min(q1 - 1.5 * iqr, med / 1.25);
    }
    let clipped = 0;
    const out = values.map((v) => { const c = Math.min(hi, Math.max(lo, v)); if (c !== v) clipped++; return c; });
    return { values: out, clipped, median: med };
  }

  /** Theil-Sen line through (x, y): the median of all pairwise slopes, so single odd points can't tilt it. */
  function trendLine(xs, ys, shrink) {
    const slopes = [];
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
    const slope = (slopes.length ? median(slopes) : 0) * shrink;
    return { slope, intercept: median(ys.map((y, i) => y - slope * xs[i])) };
  }

  /**
   * The pace a basis stands for. byLevel(L) gives { mean, low, high } days for level L.
   * basis: all | last10 | last5 | custom | fastest. Levels 1 and 2 are accelerated for everyone, so they are left out
   * whenever later levels exist.
   *
   * It works on how many times slower than the fastest possible each level was, so that:
   *  - unusually long or short levels are pulled in to a fence (see tame) before averaging, so `mean` is a typical
   *    level, not one dragged up by a single outlier (`rawMean` is the plain average, `clipped` how many were pulled in);
   *  - with six or more levels, a robust trend line lets later levels differ from earlier ones (most people slow down
   *    as the levels get bigger), instead of assuming every level takes the same time. The slope is held back
   *    when there are few levels, and the result never goes below the fastest possible or above 2.5 times your typical;
   *  - low and high are your quicker and slower levels (20th and 80th percentile), not the extremes.
   */
  function paceFor(done, basis, customDays) {
    const constant = (m, low, high) => ({ mean: m, low: low == null ? m : low, high: high == null ? m : high });
    if (basis === 'custom') {
      const d = Math.max(0.5, Number(customDays) || 10);
      return { basis, n: 0, mean: d, low: d, high: d, fallback: false, clipped: 0, trend: 0, byLevel: () => constant(d), label: `${fmt(d)} days per level (your own figure)` };
    }
    const limit = { all: Infinity, last10: 10, last5: 5 }[basis];
    const regular = done.filter((d) => d.level > 2);
    const pool = regular.length ? regular : done;
    if (basis === 'fastest' || !pool.length) {
      return {
        basis: 'fastest', n: 0, mean: FAST_NORMAL, low: FAST_NORMAL, high: FAST_NORMAL, fallback: basis !== 'fastest', clipped: 0, trend: 0,
        byLevel: (L) => constant(fastestFor(L)),
        label: `about ${FAST_NORMAL.toString().replace(/\.0$/, '')} days per level, the fastest WaniKani allows`,
      };
    }
    const used = pool.slice(-Math.min(limit, pool.length));
    const ratios = used.map((d) => Math.max(1, d.days / fastestFor(d.level)));
    const t = tame(ratios);
    const sorted = asc(t.values);
    const med = quantile(sorted, 0.5) || 1;
    const typical = mean(t.values);                       // typical slowdown, outliers pulled in
    const lowR = sorted.length > 1 ? Math.min(1, quantile(sorted, 0.2) / med) : 1;
    const highR = sorted.length > 1 ? Math.max(1, quantile(sorted, 0.8) / med) : 1;
    const base = regular.length ? FAST_NORMAL : mean(used.map((d) => fastestFor(d.level)));
    const m = typical * base;
    const useTrend = used.length >= 6 && basis !== 'last5';
    const line = useTrend ? trendLine(used.map((d) => d.level), t.values, used.length / (used.length + 8)) : null;
    // Where the trend line sits at the middle of your levels, so that it stays centred on the typical value.
    const mid = line ? median(used.map((d) => d.level)) : 0;
    const ratioAt = (L) => {
      if (!line) return typical;
      const r = typical + line.slope * (L - mid);
      return Math.min(2.5 * typical, Math.max(1, r));
    };
    const rawMean = mean(used.map((d) => d.days));
    const n = used.length;
    const trendNote = line && Math.abs(line.slope * base) >= 0.2 ? `, ${line.slope > 0 ? 'getting slower' : 'getting quicker'} by about ${fmt(Math.abs(line.slope * base))} days with each level` : '';
    return {
      basis, n, mean: m, rawMean, low: m * lowR, high: m * highR, fallback: false, clipped: t.clipped, trend: line ? line.slope * base : 0,
      byLevel: (L) => { const r = ratioAt(L), f = fastestFor(L); return constant(f * r, f * r * lowR, f * r * highR); },
      label: `${fmt(m)} days per level, typical of ${basis === 'all' ? 'all ' : 'your last '}${n} finished level${n === 1 ? '' : 's'}${t.clipped ? ` (${t.clipped} unusually ${t.clipped === 1 ? 'long or short level counts' : 'long or short levels count'} for less)` : ''}${trendNote}`,
    };
  }

  function fmt(n) { return (Math.round(n * 10) / 10).toString(); }

  /** Answer accuracy (0..1) from the review-statistics rows, or null when there are too few answers to say. */
  function accuracyOf(rows, minAnswers) {
    let c = 0, i = 0;
    Object.keys(rows || {}).forEach((id) => { const r = rows[id]; c += r[1] + r[3]; i += r[2] + r[4]; });
    return c + i >= (minAnswers || 100) ? c / (c + i) : null;
  }

  /**
   * How long until you reach `target`. The rest of the current level combines the time you have already spent on it
   * with how many of the kanji you need are at Guru (progress 0..1, optional); every further level takes the pace's days.
   * Returns days to each level on the way, so a graph can draw the whole path.
   */
  function estimate(o) {
    const { level, target, pace, elapsedDays = 0, progress = null, now = Date.now() } = o;
    if (target <= level) return { already: true, target, level };
    const remaining = (key) => {
      const d = pace.byLevel(level)[key];
      const byTime = Math.max(d - elapsedDays, 0.1 * d);
      if (progress == null) return byTime;
      const byProgress = Math.max(d * (1 - Math.min(1, Math.max(0, progress))), 0.1 * d);
      // Once you are past the usual time for a level the clock says nothing about what is left, so go by progress.
      return elapsedDays >= d ? byProgress : (byTime + byProgress) / 2;
    };
    const run = (key) => {
      let t = remaining(key);
      const path = [{ level: level + 1, days: t }];
      for (let L = level + 1; L < target; L++) { t += pace.byLevel(L)[key]; path.push({ level: L + 1, days: t }); }
      return path;
    };
    const mid = run('mean'), lo = run('low'), hi = run('high');
    const total = mid[mid.length - 1].days;
    return {
      already: false, level, target, pace, now,
      days: total, daysLow: lo[lo.length - 1].days, daysHigh: hi[hi.length - 1].days,
      date: now + total * DAY, dateLow: now + lo[lo.length - 1].days * DAY, dateHigh: now + hi[hi.length - 1].days * DAY,
      path: mid.map((p) => ({ level: p.level, days: p.days, date: now + p.days * DAY })),
      remainingCurrent: mid[0].days,
    };
  }

  root.Stats = {
    // data
    bind(id) { if (uid !== id) { uid = id; Object.keys(mem).forEach((k) => delete mem[k]); } },
    reset() { uid = null; Object.keys(mem).forEach((k) => delete mem[k]); },
    savedProgressions, fetchProgressions,
    savedReviewStats, syncReviewStats, summarizeReviewStats,
    savedHistory,
    // maths
    noteReview, dayCounts, streakInfo, criticalItems,
    normalizeProgressions, levelStats, paceFor, accuracyOf, estimate, bucketDays, bucketTimes, addReviews, emptyHistory, dayKey, keyToDate,
    DAY,
  };
})(typeof window !== 'undefined' ? window : globalThis);
