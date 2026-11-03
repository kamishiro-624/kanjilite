/* The Stats screen: an estimate of when you will reach a level, summary numbers, review statistics and graphs.
   app.js hands over what it owns (the page element, the user, a staleness check, a place to register cleanup). */
(function (root) {
  'use strict';

  const DAY = 24 * 3600 * 1000;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const { longDate, shortDate } = Charts.fmt;

  const BASES = [
    { value: 'all', label: 'All my levels' },
    { value: 'last10', label: 'My last 10 levels' },
    { value: 'last5', label: 'My last 5 levels' },
    { value: 'custom', label: 'A figure I pick' },
    { value: 'fastest', label: 'Fastest possible' },
  ];
  const STAGE_SHORT = ['A1', 'A2', 'A3', 'A4', 'G1', 'G2', 'Master', 'Enlight.', 'Burned'];
  const STAGE_LONG = ['Apprentice I', 'Apprentice II', 'Apprentice III', 'Apprentice IV', 'Guru I', 'Guru II', 'Master', 'Enlightened', 'Burned'];
  const STAGE_COLOR = Dash.SHADES; // the same shade per stage as the dashboard bars

  const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } };

  const round1 = (n) => Math.round(n * 10) / 10;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const thousands = (n) => Math.round(n).toLocaleString();
  const pct = (c, i) => (c + i ? Math.round(c / (c + i) * 1000) / 10 : null);
  const pctText = (v) => (v === null ? '–' : v + '%');

  /** "12 days", "about 3 months", "1 year and 2 months". */
  function span(days) {
    if (days < 1) return 'less than a day';
    if (days < 45) return plural(Math.round(days), 'day');
    const months = Math.floor(days / 30.44);
    const rest = Math.round(days - months * 30.44);
    if (months < 12) return plural(months, 'month') + (rest >= 3 ? ' and ' + plural(rest, 'day') : '');
    const y = Math.floor(months / 12), m = months % 12;
    return plural(y, 'year') + (m ? ' and ' + plural(m, 'month') : '');
  }

  function mount(ctx) {
    const el = ctx.el;
    const $ = (s) => el.querySelector(s);
    const user = ctx.user;
    Stats.bind(user.id);

    const D = {
      user, rows: null, rowsErr: null, progress: null, rs: null, rsLoading: true, rsCount: 0,
      hist: null, hard: null,
    };
    let target = Number(read('kl_target_level', 0)) || 0;
    let basis = read('kl_pace_basis', 'all');
    let custom = Number(read('kl_pace_custom', 12)) || 12;
    if (!BASES.some((b) => b.value === basis)) basis = 'all';
    if (target < 1 || target > 60) target = Math.min(60, (Math.floor(user.level / 10) + 1) * 10);
    let cancelled = false;
    const NO_HIST = { text: 'No reviews recorded in KanjiLite yet. This fills in as you do reviews here (WaniKani no longer provides past review history).' };
    const charts = [];

    const curLevel = () => (ctx.currentUser ? ctx.currentUser().level : user.level);
    const planMax = () => (user.subscription && user.subscription.max_level_granted) || 60;

    // ------------------------------------------------------------ page skeleton
    el.innerHTML = `<div class="wrap stats">
      <h1>Stats</h1>
      <div class="cards" id="st-cards"></div>

      <section class="panel" id="st-est">
        <h2>When will I reach a level?</h2>
        <div class="est-form">
          <label class="ctl"><span>Target level</span>${UI.stepperHTML('st-target', target, { min: 1, max: 60, step: 1, label: 'Target level' })}</label>
          <label class="ctl"><span>Pace based on</span>${UI.selectHTML('st-basis', BASES, basis, 'Pace based on')}</label>
          <label class="ctl" id="st-custom-wrap"><span>Days per level</span>${UI.stepperHTML('st-custom', Math.round(custom), { min: 1, max: 90, step: 1, label: 'Days per level' })}</label>
        </div>
        <div id="st-est-out" class="est-out" aria-live="polite"></div>
      </section>

      <div id="g-pace"></div>
      <div id="g-time"></div>

      <section class="panel" id="st-rs"><h2>Review statistics</h2><div id="st-rs-body"><p class="muted">Loading…</p></div></section>

      <section class="panel" id="st-hist"></section>
      <div id="g-heat"></div>
      <div id="g-rev"></div>
      <div id="g-hour"></div>
      <div id="g-srs"></div>
    </div>`;

    $('#st-custom-wrap').hidden = basis !== 'custom';

    // ------------------------------------------------------------ the estimate
    function compute() {
      const lvl = curLevel();
      const now = Date.now();
      const ls = Stats.levelStats(D.rows || [], lvl, now);
      const pace = Stats.paceFor(ls.done, basis, custom);
      const est = Stats.estimate({ level: lvl, target, pace, elapsedDays: ls.elapsedDays, progress: D.progress ? D.progress.fraction : null, now });
      return { lvl, now, ls, pace, est };
    }

    function drawEstimate() {
      const out = $('#st-est-out');
      if (D.rowsErr && !D.rows) {
        out.innerHTML = `<p class="error">Could not load your level history: ${esc(D.rowsErr)}</p><button class="btn small" type="button" id="st-retry">Try again</button>`;
        $('#st-retry').onclick = () => { D.rowsErr = null; out.innerHTML = '<p class="muted">Loading…</p>'; loadLevels(true); };
        return;
      }
      if (!D.rows) { out.innerHTML = '<p class="muted">Loading your level history…</p>'; return; }
      const { lvl, ls, pace, est } = compute();
      if (est.already) {
        const when = ls.reachedAt(target);
        out.innerHTML = target === lvl
          ? `<p class="est-line">You are on level ${lvl} right now${ls.since ? `, and have been for ${span(ls.elapsedDays)}` : ''}. Pick a higher target to see an estimate.</p>`
          : `<p class="est-line">You are already past level ${target}${when ? `: you reached it on <b>${esc(longDate(when))}</b>` : ''}. Pick a higher target to see an estimate.</p>`;
        return;
      }
      const notes = [];
      if (pace.fallback) notes.push('There are not enough finished levels yet to measure your pace, so this assumes the fastest possible one.');
      if (target > planMax()) notes.push(`Your WaniKani plan currently unlocks levels up to ${planMax()}.`);
      const cur = [];
      if (ls.since) cur.push(`${span(ls.elapsedDays)} into level ${lvl}`);
      if (D.progress) cur.push(`${D.progress.done} of the ${D.progress.need} kanji you need at Guru`);
      let table = est.path;
      if (table.length > 12) table = table.filter((p, i) => p.level % 5 === 0 || i === table.length - 1);
      out.innerHTML = `
        <div class="est-main"><div class="est-date">${esc(longDate(est.date))}</div><div class="est-sub">level ${target} in about ${esc(span(est.days))}</div></div>
        <p class="est-line">If every level goes like your quicker ones, ${esc(shortDate(est.dateLow))}; like your slower ones, ${esc(longDate(est.dateHigh))}.</p>
        <p class="muted est-line">Pace used: ${esc(pace.label)}.${cur.length ? ' Right now you are ' + esc(cur.join(', ')) + '.' : ''}</p>
        ${notes.map((n) => `<p class="warn-note">${esc(n)}</p>`).join('')}
        <div class="table-wrap"><table class="miles"><thead><tr><th>Level</th><th>Around</th><th>In</th></tr></thead><tbody>
          ${table.map((p) => `<tr><td>${p.level}</td><td>${esc(longDate(p.date))}</td><td>${esc(span(p.days))}</td></tr>`).join('')}
        </tbody></table></div>`;
    }

    function estimateChanged() {
      drawEstimate();
      drawCards();
      charts.forEach((c) => { if (c.dependsOnEstimate) c.update(); });
    }

    UI.bindStepper($('#st-target').closest('[data-stepper]'), (v) => { target = v; write('kl_target_level', v); estimateChanged(); });
    UI.bindSelect($('#st-basis').closest('[data-select]'), (v) => {
      basis = v; write('kl_pace_basis', v);
      $('#st-custom-wrap').hidden = v !== 'custom';
      estimateChanged();
    });
    UI.bindStepper($('#st-custom').closest('[data-stepper]'), (v) => { custom = v; write('kl_pace_custom', v); estimateChanged(); });

    // ------------------------------------------------------------ summary cards
    function lessonTimes() {
      return Local.allAssignments().filter((a) => a.data.started_at && !a.data.hidden).map((a) => Date.parse(a.data.started_at));
    }
    function perDay(total, days) { return round1(total / days); }

    function drawCards() {
      const c = [];
      const { lvl, ls } = compute();
      c.push(card(`Level ${lvl}`, ls.since ? `${span(ls.elapsedDays)} on this level` : '', 'Current'));
      const sk = Stats.streakInfo(Stats.dayCounts(D.hist));
      if (sk.best) c.push(card(plural(sk.current, 'day'), 'review streak', `Longest: ${sk.best}`));
      if (D.rows) {
        const all = Stats.paceFor(ls.done, 'all');
        c.push(card(all.n ? `${round1(all.mean)} days` : '–', 'per level, on average', all.n ? `over ${plural(all.n, 'level')}` : 'no finished levels yet'));
        if (ls.done.length) {
          const pool = ls.done.filter((d) => d.level > 2); // levels 1 and 2 are accelerated for everyone
          const list = pool.length ? pool : ls.done;
          const fast = list.reduce((a, b) => (b.days < a.days ? b : a));
          const slow = list.reduce((a, b) => (b.days > a.days ? b : a));
          c.push(card(`${round1(fast.days)} days`, 'your fastest level', `level ${fast.level}`));
          c.push(card(`${round1(slow.days)} days`, 'your slowest level', `level ${slow.level}`));
        }
      }
      if (user.started_at) c.push(card(span((Date.now() - Date.parse(user.started_at)) / DAY), 'on WaniKani', `since ${longDate(Date.parse(user.started_at))}`));
      const now = Date.now();
      const lessons30 = lessonTimes().filter((t) => now - t <= 30 * DAY).length;
      c.push(card(String(perDay(lessons30, 30)), 'lessons a day', 'last 30 days'));
      if (D.hist && D.hist.n) {
        let n30 = 0;
        for (let i = 0; i < 30; i++) { const r = D.hist.days[Stats.dayKey(new Date(now - i * DAY))]; if (r) n30 += r[0]; }
        c.push(card(String(perDay(n30, 30)), 'reviews a day', 'last 30 days'));
      }
      if (D.rs) { const a = D.rs.answers; c.push(card(pctText(pct(a.c, a.i)), 'of answers correct', `${thousands(a.c + a.i)} answers`)); }
      $('#st-cards').innerHTML = c.join('');
    }
    const card = (value, label, sub) => `<div class="card"><b>${esc(value)}</b><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;

    // ------------------------------------------------------------ review statistics
    function drawReviewStats() {
      const box = $('#st-rs-body');
      if (!D.rs) {
        box.innerHTML = D.rsErr
          ? `<p class="error">Could not load review statistics: ${esc(D.rsErr)}</p><button class="btn small" type="button" id="rs-retry">Try again</button>`
          : `<p class="muted">Loading review statistics${D.rsCount ? `… ${thousands(D.rsCount)} items so far` : '…'}</p>`;
        const r = $('#rs-retry'); if (r) r.onclick = () => { D.rsErr = null; loadReviewStats(true); };
        return;
      }
      const s = D.rs;
      if (!s.items) { box.innerHTML = '<p class="muted">Nothing here yet. Statistics appear once you have done some reviews.</p>'; return; }
      const bar = (label, v, extra) => `<div class="acc"><div class="acc-top"><span>${esc(label)}</span><b>${pctText(v)}</b></div>
        <div class="meter small" role="img" aria-label="${esc(label)} ${pctText(v)}"><i style="width:${v === null ? 0 : v}%"></i></div>${extra ? `<small class="muted">${esc(extra)}</small>` : ''}</div>`;
      const t = s.byType;
      box.innerHTML = `<div class="acc-grid">
          ${bar('All answers', pct(s.answers.c, s.answers.i), `${thousands(s.answers.c)} right, ${thousands(s.answers.i)} wrong`)}
          ${bar('Meanings', pct(s.meaning.c, s.meaning.i), `${thousands(s.meaning.c + s.meaning.i)} answers`)}
          ${bar('Readings', pct(s.reading.c, s.reading.i), `${thousands(s.reading.c + s.reading.i)} answers`)}
          ${bar('Radicals', pct(t.radical.c, t.radical.i), plural(t.radical.items, 'item'))}
          ${bar('Kanji', pct(t.kanji.c, t.kanji.i), plural(t.kanji.items, 'item'))}
          ${bar('Vocabulary', pct(t.vocabulary.c, t.vocabulary.i), plural(t.vocabulary.items, 'item'))}
        </div>
        <h3>Items you miss most</h3>
        <div id="st-hard">${s.hard.length ? '<p class="muted">Loading…</p>' : '<p class="muted">No troublesome items yet. Items show up here after a handful of answers.</p>'}</div>`;
      if (s.hard.length) drawHard(s.hard);
    }

    async function drawHard(hard) {
      try {
        const subs = await api.getSubjects(hard.map((h) => h.id), { background: true });
        if (cancelled) return;
        const box = $('#st-hard');
        if (!box) return;
        box.innerHTML = `<div class="tiles hard">${hard.filter((h) => subs.has(h.id)).map((h) => `<div class="hard-item">${ctx.tile(subs.get(h.id))}<small>${Math.round(h.pct)}% right, ${plural(h.wrong, 'miss')}</small></div>`).join('')}</div>`;
      } catch (e) {
        const box = $('#st-hard'); if (box) box.innerHTML = '<p class="muted">Could not load the item details.</p>';
      }
    }

    // ------------------------------------------------------------ review history panel
    // WaniKani no longer provides past reviews, so this only describes what KanjiLite has recorded itself.
    function drawHistPanel() {
      const box = $('#st-hist');
      const h = D.hist;
      let html = '<h2>Review history</h2>';
      if (h && h.n) {
        html += `<p class="muted">${thousands(h.n)} ${h.n === 1 ? 'review' : 'reviews'} recorded in KanjiLite${h.first ? ', since ' + esc(longDate(h.first)) : ''}. The review graphs below cover these.</p>`;
      } else {
        html += '<p class="muted">The review graphs below (reviews per day, accuracy over time, busiest hours) fill in as you do reviews in KanjiLite.</p>';
      }
      html += '<p class="muted">WaniKani no longer keeps individual reviews, so its API has no review history to download. Reviews done before, or on the WaniKani site or another app, cannot be included. Only daily totals are kept in this browser.</p>';
      box.innerHTML = html;
    }
    function refreshHistoryViews() { drawCards(); charts.forEach((c) => { if (c.dependsOnHistory) c.update(); }); }

    // ------------------------------------------------------------ loading
    async function loadLevels(force) {
      try {
        const saved = await Stats.savedProgressions();
        if (cancelled) return;
        if (saved && !force) {
          D.rows = saved.rows;
          afterLevels();
          if (Date.now() - saved.at < 5 * 60000) return;
        }
        const rows = await Stats.fetchProgressions({ background: !!D.rows });
        if (cancelled) return;
        D.rows = rows; D.rowsErr = null;
        afterLevels();
      } catch (e) {
        if (cancelled) return;
        if (ctx.syncFailed) ctx.syncFailed(e);
        if (!D.rows) { D.rowsErr = e.message; drawEstimate(); }
      }
    }
    function afterLevels() { estimateChanged(); }

    async function loadProgress() {
      try {
        const lvl = curLevel();
        const subs = await Local.levelSubjects(lvl, { background: true });
        if (cancelled) return;
        const kanji = subs.filter((x) => x.object === 'kanji' && !x.data.hidden_at);
        const need = Math.ceil(kanji.length * 0.9);
        const done = kanji.filter((x) => { const a = Local.assignmentFor(x.id); return a && a.data.srs_stage >= 5; }).length;
        D.progress = need ? { done, need, fraction: Math.min(1, done / need) } : null;
        estimateChanged();
      } catch (e) { /* the estimate works without it */ }
    }

    async function loadReviewStats(force) {
      D.rsLoading = true;
      try {
        const saved = await Stats.savedReviewStats();
        if (cancelled) return;
        if (saved && !force) { D.rs = Stats.summarizeReviewStats(saved.rows); drawReviewStats(); drawCards(); }
        const fresh = await Stats.syncReviewStats({ force: !!force, onProgress: (n) => { if (!D.rs) { D.rsCount = n; drawReviewStats(); } } });
        if (cancelled) return;
        D.rs = Stats.summarizeReviewStats(fresh.rows); D.rsErr = null;
        drawReviewStats(); drawCards();
      } catch (e) {
        if (cancelled) return;
        if (ctx.syncFailed) ctx.syncFailed(e);
        if (!D.rs) { D.rsErr = e.message; drawReviewStats(); }
      }
      D.rsLoading = false;
    }

    // ------------------------------------------------------------ graphs
    const days = (n) => `${round1(n)} ${Math.abs(round1(n)) === 1 ? 'day' : 'days'}`;

    function addChart(host, spec, flags) {
      const c = Charts.create($(host), spec);
      Object.assign(c, flags || {});
      charts.push(c);
      return c;
    }

    // 1. time per level (bars), or total days since you began (line)
    addChart('#g-pace', {
      id: 'c-pace', title: 'Time per level',
      note: 'Faded bars and dashed lines are estimates from the pace chosen above.',
      controls: [
        { key: 'metric', label: 'Show', value: 'days', options: [{ value: 'days', label: 'Days per level' }, { value: 'total', label: 'Total days so far' }] },
        { key: 'proj', label: 'Estimate', value: 'on', options: [{ value: 'on', label: 'Shown' }, { value: 'off', label: 'Hidden' }] },
      ],
      data(st) {
        if (!D.rows) return { series: [], empty: { text: D.rowsErr ? 'Your level history could not be loaded.' : 'Loading your level history…' } };
        const { lvl, now, ls, est } = compute();
        const withProjection = st.proj === 'on' && !est.already;
        if (st.metric === 'days') {
          const actual = ls.done.map((d) => ({ x: d.level, y: round1(d.days), tip: `Level ${d.level}: ${days(d.days)} (${shortDate(d.unlocked)} to ${shortDate(d.passed)})` }));
          const bars = [{ name: 'Finished', kind: 'bar', barW: 1, points: actual }];
          const rest = [];
          if (ls.since) rest.push({ x: lvl, y: round1(ls.elapsedDays), dim: true, tip: `Level ${lvl} so far: ${days(ls.elapsedDays)} (in progress)` });
          if (withProjection) {
            for (let L = lvl + 1; L < target; L++) { const m = est.pace.byLevel(L).mean; rest.push({ x: L, y: round1(m), dim: true, tip: `Level ${L}, estimated: about ${days(m)}` }); }
          }
          bars.push({ name: 'In progress / estimated', kind: 'bar', barW: 1, points: rest });
          return { xType: 'number', xInteger: true, xLabel: 'Level', yLabel: 'Days', xFmt: (v) => String(Math.round(v)), yFmt: (v) => String(round1(v)), series: bars, empty: { text: 'Finish a level to see how long your levels take.' } };
        }
        const start = ls.done.length ? ls.done[0].unlocked : (ls.since || now);
        const points = [];
        (D.rows || []).filter((r) => r.unlocked && r.level <= lvl).forEach((r) => points.push({ x: r.level, y: round1((r.unlocked - start) / DAY), tip: `Reached level ${r.level} after ${days((r.unlocked - start) / DAY)} (${longDate(r.unlocked)})` }));
        const series = [{ name: 'So far', kind: 'line', points }];
        if (withProjection) {
          const nowDays = (now - start) / DAY;
          const proj = [{ x: lvl, y: round1(nowDays), tip: 'Today' }];
          est.path.forEach((p) => proj.push({ x: p.level, y: round1(nowDays + p.days), dim: true, tip: `Level ${p.level}, estimated around ${longDate(p.date)}: day ${Math.round(nowDays + p.days)}` }));
          series.push({ name: 'Estimate', kind: 'line', dashed: true, points: proj });
        }
        return { xType: 'number', xInteger: true, xLabel: 'Level reached', yLabel: 'Days since you began', xFmt: (v) => String(Math.round(v)), yFmt: (v) => String(Math.round(v)), yZero: true, series, empty: { text: 'Your level history is empty so far.' } };
      },
    }, { dependsOnEstimate: true });

    // 2. level over time
    addChart('#g-time', {
      id: 'c-time', title: 'Level over time',
      note: 'Each dot is the day you reached a level. The dashed line carries on from today at the estimated pace.',
      data() {
        if (!D.rows) return { series: [], empty: { text: D.rowsErr ? 'Your level history could not be loaded.' : 'Loading your level history…' } };
        const { lvl, now, est } = compute();
        const pts = D.rows.filter((r) => r.unlocked && r.level <= lvl).map((r) => ({ x: r.unlocked, y: r.level, tip: `Reached level ${r.level} on ${longDate(r.unlocked)}` }));
        const series = [{ name: 'So far', kind: 'step', points: pts.concat(pts.length ? [{ x: now, y: lvl, tip: `Today: level ${lvl}` }] : []) }];
        if (!est.already) {
          series.push({ name: 'Estimate', kind: 'line', dashed: true, points: [{ x: now, y: lvl, tip: `Today: level ${lvl}` }].concat(est.path.map((p) => ({ x: p.date, y: p.level, dim: true, tip: `Level ${p.level}, estimated around ${longDate(p.date)}` }))) });
        }
        return { xType: 'date', yZero: false, xInteger: false, xLabel: 'Date', yLabel: 'Level', yFmt: (v) => String(Math.round(v * 10) / 10), series, markers: [{ x: now, label: 'Today' }], empty: { text: 'Your level history is empty so far.' } };
      },
    }, { dependsOnEstimate: true });

    // Calendar heatmap of reviews done.
    {
      const heat = Heatmap.create($('#g-heat'), {
        id: 'c-heat', title: 'Reviews heatmap', unit: 'review',
        note: 'One square per day. Darker means more reviews that day.',
        counts: () => (D.hist && D.hist.n ? Stats.dayCounts(D.hist) : null),
        empty: () => NO_HIST,
      });
      heat.dependsOnHistory = true;
      charts.push(heat);
    }

    // 3. reviews, accuracy, mistakes, lessons over time
    const RANGES = [
      { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' },
      { value: '365', label: 'Last year' }, { value: 'all', label: 'All time' },
    ];
    const BUCKET_W = { day: DAY, week: 7 * DAY, month: 30.44 * DAY };
    addChart('#g-rev', {
      id: 'c-rev', title: 'Reviews and lessons over time',
      controls: [
        { key: 'metric', label: 'Show', value: 'reviews', options: [
          { value: 'reviews', label: 'Reviews done' }, { value: 'clean', label: 'Reviews with no mistake (%)' },
          { value: 'wrong', label: 'Wrong answers' }, { value: 'lessons', label: 'Lessons started' }] },
        { key: 'group', label: 'Group by', value: 'day', options: [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }] },
        { key: 'range', label: 'Range', value: '90', options: RANGES },
        { key: 'style', label: 'Style', value: 'bar', options: [{ value: 'bar', label: 'Bars' }, { value: 'line', label: 'Line' }] },
      ],
      data(st) {
        const needHistory = st.metric !== 'lessons';
        if (needHistory && !(D.hist && D.hist.n)) {
          return { series: [], empty: NO_HIST };
        }
        const rows = needHistory ? Stats.bucketDays(D.hist.days, st.group, st.metric === 'reviews' || st.metric === 'wrong')
          : Stats.bucketTimes(lessonTimes(), st.group);
        const w = BUCKET_W[st.group];
        const cutoff = st.range === 'all' ? -Infinity : Date.now() - Number(st.range) * DAY;
        const points = [];
        rows.forEach((r) => {
          if (r.t + w < cutoff) return;
          let y;
          if (st.metric === 'reviews' || st.metric === 'lessons') y = r.v[0];
          else if (st.metric === 'wrong') y = r.v[2] + r.v[3];
          else { if (!r.v[0]) return; y = Math.round(r.v[1] / r.v[0] * 1000) / 10; }
          const label = st.group === 'day' ? longDate(r.t) : st.group === 'week' ? 'Week of ' + longDate(r.t) : new Date(r.t).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
          const what = { reviews: plural(y, 'review'), lessons: plural(y, 'lesson'), wrong: plural(y, 'wrong answer'), clean: `${y}% without a mistake (${plural(r.v[0], 'review')})` }[st.metric];
          points.push({ x: r.t + (st.style === 'bar' ? w / 2 : 0), y, tip: `${label}: ${what}` });
        });
        const names = { reviews: 'Reviews', clean: '% without a mistake', wrong: 'Wrong answers', lessons: 'Lessons' };
        return {
          xType: 'date', xLabel: 'Date', yLabel: names[st.metric], yFmt: st.metric === 'clean' ? (v) => v + '%' : undefined,
          series: [{ name: names[st.metric], kind: st.style, barW: w, points }],
          empty: { text: st.metric === 'lessons' ? 'No lessons started in this range.' : 'No reviews in this range.' },
        };
      },
    }, { dependsOnHistory: true });

    // 4. busiest hours
    addChart('#g-hour', {
      id: 'c-hour', title: 'When you review',
      note: 'Reviews by the hour of the day they were done (your local time).',
      controls: [{ key: 'metric', label: 'Show', value: 'reviews', options: [{ value: 'reviews', label: 'Reviews done' }, { value: 'clean', label: 'Reviews with no mistake (%)' }] }],
      data(st) {
        if (!(D.hist && D.hist.n)) return { series: [], empty: NO_HIST };
        const hh = (h) => `${h}:00 to ${h}:59`;
        const points = [];
        D.hist.hours.forEach((v, h) => {
          if (st.metric === 'reviews') points.push({ x: h, y: v[0], tip: `${hh(h)}: ${plural(v[0], 'review')}` });
          else if (v[0]) points.push({ x: h, y: Math.round(v[1] / v[0] * 1000) / 10, tip: `${hh(h)}: ${Math.round(v[1] / v[0] * 1000) / 10}% without a mistake (${plural(v[0], 'review')})` });
        });
        return {
          xType: 'number', xInteger: true, xLabel: 'Hour of the day', yLabel: st.metric === 'reviews' ? 'Reviews' : '% without a mistake',
          yFmt: st.metric === 'clean' ? (v) => v + '%' : undefined,
          xTicks: [0, 3, 6, 9, 12, 15, 18, 21].map((h) => ({ x: h, label: `${h}:00` })),
          series: [{ name: 'Reviews', kind: 'bar', barW: 1, points }],
        };
      },
    }, { dependsOnHistory: true });

    // 5. where your items are in the SRS
    addChart('#g-srs', {
      id: 'c-srs', title: 'Items by SRS stage',
      note: 'How many items sit at each stage right now.',
      controls: [{ key: 'type', label: 'Items', value: 'all', options: [{ value: 'all', label: 'All' }, { value: 'radical', label: 'Radicals' }, { value: 'kanji', label: 'Kanji' }, { value: 'vocabulary', label: 'Vocabulary' }] }],
      data(st) {
        const counts = new Array(9).fill(0);
        Local.allAssignments().forEach((a) => {
          const d = a.data;
          if (d.hidden || d.srs_stage < 1 || d.srs_stage > 9) return;
          const t = d.subject_type === 'kana_vocabulary' ? 'vocabulary' : d.subject_type;
          if (st.type !== 'all' && t !== st.type) return;
          counts[d.srs_stage - 1]++;
        });
        return {
          xType: 'number', xInteger: true, yLabel: 'Items',
          xTicks: STAGE_SHORT.map((l, i) => ({ x: i + 1, label: l })),
          series: [{ name: 'Items', kind: 'bar', barW: 1, points: counts.map((n, i) => ({ x: i + 1, y: n, color: STAGE_COLOR[i], tip: `${STAGE_LONG[i]}: ${plural(n, 'item')}` })) }],
          empty: { text: 'No items in the SRS yet.' },
        };
      },
    }, { dependsOnLocal: true });

    // ------------------------------------------------------------ go
    drawCards();
    drawEstimate();
    drawReviewStats();
    drawHistPanel();

    const unsub = Local.subscribe(() => {
      drawCards();
      charts.forEach((c) => { if (c.dependsOnLocal) c.update(); });
    });

    ctx.setCleanup(() => { cancelled = true; unsub(); charts.forEach((c) => c.destroy()); });

    loadLevels();
    loadProgress();
    loadReviewStats();
    Stats.savedHistory().then((h) => {
      if (cancelled) return;
      if (h && h.n) {
        D.hist = h;
        drawHistPanel(); refreshHistoryViews();
      }
    }).catch(() => {});
  }

  root.StatsView = { mount };
})(window);
