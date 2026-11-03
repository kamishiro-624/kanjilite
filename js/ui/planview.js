/* The Plan screen and the dashboard's "off track" banner.
   Pick a level and a date; the pace, the daily workload and a date for every level update as you change either.
   Saving makes it your plan, and the dashboard warns you when you fall behind it. */
(function (root) {
  'use strict';

  const DAY = 24 * 3600 * 1000;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateText = (ms) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  const r1 = (n) => Math.round(n * 10) / 10;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const num = (n) => Math.round(n).toLocaleString();
  const posText = (p) => `level ${Math.floor(p)}, ${Math.round((p - Math.floor(p)) * 100)}% through`;
  const endOfDay = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 0).getTime(); };
  const MAX_LEVEL = 60;

  /** Dashboard banner for a plan you have fallen behind, or '' when there is nothing to say. */
  function banner(plan, ev) {
    if (!ev || ev.state === 'done' || ev.state === 'on' || ev.state === 'ahead') return '';
    const head = `Plan: level ${plan.target} by ${dateText(plan.end)}`;
    let msg;
    if (ev.state === 'late') {
      msg = `<b>${esc(head)} has passed.</b> You’re at level ${Math.floor(ev.pos)}. Set a new date to get a fresh plan.`;
    } else {
      const lv = Math.abs(ev.gap);
      msg = `<b>You’re ${lv < 1.05 ? 'about a level' : `about ${r1(lv)} levels`} behind your plan.</b> ${esc(head)} has you at ${posText(ev.expected)} by now; you’re at ${posText(ev.pos)}. `;
      msg += ev.impossible
        ? `That date is now quicker than WaniKani allows (earliest: ${dateText(ev.earliest)}), so consider moving it.`
        : `To still make it, aim for about ${r1(ev.neededPerLevel)} days per level (the plan assumed ${r1(ev.plannedPerLevel)}).`;
    }
    return `<div class="banner plan-banner">${msg}
      <div class="row" style="margin-top:8px"><a class="btn ghost small" href="#/plan">Open plan</a><button class="link" id="plan-dismiss" type="button">Dismiss for today</button></div></div>`;
  }

  function mount(o) {
    const { el } = o;
    let dead = false;
    o.setCleanup(() => { dead = true; });
    const user = o.currentUser();
    const level = user.level;
    const uid = user.id;

    if (level >= MAX_LEVEL) {
      el.innerHTML = '<div class="wrap"><div class="greet"><h1>Plan</h1></div><div class="panel"><p>You’re on the final level, so there’s nothing left to plan.</p></div></div>';
      return;
    }

    let saved = Plan.load(uid);
    const counts = {};       // level -> items still to learn there (exact, once that level has been downloaded)
    let old = { n: 0, from: 0 }; // lessons still waiting from levels below yours (n items, oldest level `from`)
    let frac = null;         // how far through the current level you are, once known
    let pace = null;         // your own pace, from your finished levels
    const now0 = Date.now();
    const st = { target: Math.min(MAX_LEVEL, Math.max(level + 1, saved ? saved.target : (level < 30 ? 30 : MAX_LEVEL))), end: 0 };
    st.end = saved ? saved.end : now0 + Plan.fastestDays(level, st.target) * 1.5 * DAY;

    const dayKey = (ms) => Stats.dayKey(new Date(ms));
    const items = (L) => (counts[L] != null ? counts[L] : Plan.DEFAULT_ITEMS);
    const pos = () => level + (frac || 0);
    const compute = (end) => Plan.make({ pos: pos(), target: st.target, end, now: Date.now(), items, behind: old.n });
    const exact = () => { for (let L = level; L < st.target; L++) if (counts[L] == null) return false; return true; };

    el.innerHTML = `<div class="wrap plan">
      <div class="greet"><h1>Plan</h1><p class="muted">Choose a level and a date. KanjiLite works out the pace and the daily workload, and the dashboard tells you if you fall behind.</p></div>
      <div class="panel"><h2>Your goal</h2>
        <div class="plan-form">
          <div class="field"><label for="p-target">Reach level</label>${UI.stepperHTML('p-target', st.target, { min: level + 1, max: MAX_LEVEL, step: 1, label: 'Target level' })}</div>
          <div class="field"><label for="p-end">By</label><input type="date" id="p-end" class="datein" value="${dayKey(st.end)}"></div>
        </div>
        <div id="plan-status"></div>
      </div>
      <div id="plan-out"></div>
    </div>`;
    const $ = (s) => el.querySelector(s);
    const endInput = $('#p-end');
    const setEnd = (ms) => { st.end = ms; endInput.value = dayKey(ms); update(); };

    function statusHTML() {
      if (!saved || frac == null) return '';
      const ev = Plan.evaluate(saved, level + frac, Date.now());
      const head = `Saved plan: level ${saved.target} by ${dateText(saved.end)}.`;
      let line;
      if (ev.state === 'done') line = 'You’ve reached that level.';
      else if (ev.state === 'late') line = 'The date has passed. Set a new one below.';
      else if (ev.state === 'behind') line = `You’re about ${r1(-ev.gap)} level${-ev.gap < 1.05 ? '' : 's'} behind.`;
      else if (ev.state === 'ahead') line = `You’re about ${r1(ev.gap)} level${ev.gap < 1.05 ? '' : 's'} ahead.`;
      else line = 'You’re on track.';
      return `<p class="plan-saved ${ev.state}">${esc(head)} <b>${esc(line)}</b></p>`;
    }

    function update() {
      if (dead) return;
      $('#plan-status').innerHTML = statusHTML();
      const now = Date.now();
      if (st.end <= now) {
        $('#plan-out').innerHTML = '<div class="panel"><p class="error">Pick a date after today.</p></div>';
        return;
      }
      const p = compute(st.end);
      const presets = [{ label: 'Fastest possible', end: p.earliest }];
      [1.5, 2, 3].forEach((k) => presets.push({ label: `${k}× slower than fastest`, end: now + p.fastest * k * DAY }));
      if (pace && pace.n) {
        const est = Stats.estimate({ level, target: st.target, pace, elapsedDays: 0, progress: frac, now });
        if (!est.already) presets.splice(1, 0, { label: 'At your own pace', end: est.date });
      }
      const rows = presets.map((x) => {
        const q = compute(x.end);
        return `<button type="button" class="preset" data-end="${Math.round(x.end)}"><b>${esc(x.label)}</b><span>${esc(dateText(x.end))} · ${r1(q.perLevel)} days a level</span><span>${num(q.lessonsPerDay)} lessons and about ${num(q.reviewsAvg)} reviews a day</span></button>`;
      }).join('');

      const mine = pace && pace.n ? `<p class="muted">Your average is ${r1(pace.mean)} days per level; this plan ${p.feasible ? `asks for ${r1(p.perLevel)}${p.perLevel < pace.mean ? ` (${Math.round((1 - p.perLevel / pace.mean) * 100)}% faster than you’ve been going)` : p.perLevel > pace.mean ? ` (${Math.round((p.perLevel / pace.mean - 1) * 100)}% slower)` : ''}` : 'is not possible at that date'}.</p>` : '';
      const verdict = p.feasible ? '' : `<div class="banner">That’s quicker than WaniKani allows. The earliest you could reach level ${st.target} is <b>${esc(dateText(p.earliest))}</b>; the numbers below are for that date. <button class="link" id="use-earliest" type="button">Use that date</button></div>`;
      const canSave = p.feasible && frac != null;

      $('#plan-out').innerHTML = `${verdict}
        <div class="panel"><h2>What it takes</h2>
          <div class="cards">
            <div class="card"><b>${r1(p.perLevel)}</b><span>days per level</span><small>Fastest possible: ${r1(p.fastestPerLevel)}</small></div>
            <div class="card"><b>${num(p.lessonsPerDay)}</b><span>new lessons a day</span><small>${num(p.itemsLeft)} items in all${p.behind ? `, including ${num(p.behind)} from earlier levels (oldest: level ${old.from})` : ''}</small></div>
            <div class="card"><b>~${num(p.reviewsAvg)}</b><span>reviews a day, on average</span><small>Busiest weeks: about ${num(p.reviewsPeak)}</small></div>
            <div class="card"><b>${esc(dateText(st.end > p.earliest ? st.end : p.earliest))}</b><span>level ${st.target}</span><small>${plural(Math.ceil((Math.max(st.end, p.earliest) - now) / DAY), 'day')} from today</small></div>
          </div>
          ${mine}
          <div class="row" style="margin-top:6px">
            <button class="btn" id="plan-save" type="button"${canSave ? '' : ' disabled'}>${saved ? 'Update my plan' : 'Save as my plan'}</button>
            ${saved ? '<button class="btn ghost" id="plan-clear" type="button">Remove plan</button>' : ''}
          </div>
          <p class="fine">${p.behind ? `Lessons still waiting from earlier levels are included (${num(p.behind)}). ` : ''}Reviews are estimated from WaniKani’s standard intervals and about 85% correct answers, and count only items you haven’t started yet; reviews already in your queue come on top. ${exact() ? 'Item counts are exact.' : `Item counts use about ${Plan.DEFAULT_ITEMS} per level until each level has been downloaded (this happens quietly while you’re here).`}</p>
        </div>
        <div class="panel"><h2>Pick a pace</h2><p class="muted">Going faster means more lessons and reviews each day. Tap one to use its date.</p><div class="presets">${rows}</div></div>
        <details class="panel" open><summary><h2 style="display:inline">Level by level</h2></summary>
          <div class="plan-table"><table><thead><tr><th>Reach level</th><th>By</th></tr></thead><tbody>${p.milestones.map((m) => `<tr><td>${m.level}</td><td>${esc(dateText(m.date))}</td></tr>`).join('')}</tbody></table></div>
        </details>`;

      el.querySelectorAll('.preset').forEach((b) => { b.onclick = () => setEnd(Number(b.dataset.end)); });
      const ue = $('#use-earliest'); if (ue) ue.onclick = () => setEnd(endOfDay(dayKey(p.earliest)));
      const sv = $('#plan-save');
      if (sv) sv.onclick = () => {
        saved = { target: st.target, end: st.end, start: Date.now(), startPos: level + frac };
        Plan.save(uid, saved);
        o.toast('Plan saved. The dashboard will tell you if you fall behind.');
        update();
      };
      const cl = $('#plan-clear');
      if (cl) cl.onclick = async () => {
        const ok = await UI.confirm({ title: 'Remove your plan?', message: 'The dashboard will stop comparing you with it.', ok: 'Remove', danger: true });
        if (ok) { Plan.clear(); saved = null; o.toast('Plan removed.'); update(); }
      };
    }

    UI.bindStepper($('#p-target').closest('[data-stepper]'), (v) => { st.target = v; update(); fill(); });
    endInput.onchange = () => { if (endInput.value) { st.end = endOfDay(endInput.value); update(); } };
    update();

    // Your own pace (from finished levels) and the real number of items per level, filled in as they become known.
    Stats.savedProgressions().then((lp) => {
      if (dead || !lp) return;
      pace = Stats.paceFor(Stats.levelStats(lp.rows, level, Date.now()).done, 'all');
      update();
    }).catch(() => {});
    // Lessons you still have from levels below your current one (you can be on level 14 with level 12 vocabulary
    // waiting). They are in your lesson queue, so they count towards the workload. Levels that are already
    // saved on this device are counted in full (that includes items not unlocked yet); otherwise the queue is used.
    async function scanOlder() {
      try {
        await Local.ready;
        const queue = Local.lessonsAvailable();
        if (!queue.length) return;
        const subs = await api.getSubjects(queue.map((a) => a.data.subject_id), { background: true });
        if (dead) return;
        const queued = {};
        queue.forEach((a) => { const sj = subs.get(a.data.subject_id); if (sj && sj.data.level < level && !sj.data.hidden_at) queued[sj.data.level] = (queued[sj.data.level] || 0) + 1; });
        const lows = Object.keys(queued).map(Number).sort((a, b) => a - b);
        if (!lows.length) return;
        let n = 0;
        for (let L = lows[0]; L < level; L++) {
          if (Local.levelDone(L)) {
            const all = await Local.levelSubjects(L, { background: true });
            if (dead) return;
            n += all.filter((s) => { if (s.data.hidden_at) return false; const a = Local.assignmentFor(s.id); return !(a && a.data.started_at); }).length;
          } else n += queued[L] || 0;
        }
        old = { n, from: lows[0] };
        update();
      } catch (e) { /* the plan works without it */ }
    }
    scanOlder();
    let running = false;
    async function fill() {
      if (running) return;
      running = true;
      try {
        for (let L = level; L < Math.min(MAX_LEVEL, st.target) && !dead; L++) {
          if (counts[L] != null) continue;
          const subs = await Local.levelSubjects(L, { background: L !== level });
          if (dead) return;
          const live = subs.filter((s) => !s.data.hidden_at);
          if (L === level) {
            frac = Plan.levelFraction(subs, Local.assignmentFor);
            counts[L] = live.filter((s) => { const a = Local.assignmentFor(s.id); return !(a && a.data.started_at); }).length;
          } else counts[L] = live.length;
          update();
        }
      } catch (e) { /* the estimates stay in place */ } finally { running = false; }
    }
    fill();
  }

  root.PlanView = { mount, banner };
})(window);
