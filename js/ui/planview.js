/* The Plan screen and the dashboard's "off track" banner.
   Pick a level and a date; the pace and the daily workload update as you change either.
   Saving makes it your plan, and the dashboard warns you when you fall behind it. */
(function (root) {
  'use strict';

  const DAY = 24 * 3600 * 1000;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateText = (ms) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  const r1 = (n) => Math.round(n * 10) / 10;
  const num = (n) => Math.round(n).toLocaleString();
  const posText = (p) => `level ${Math.floor(p)}, ${Math.round((p - Math.floor(p)) * 100)}% through`;
  const endOfDay = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 0).getTime(); };
  const MAX_LEVEL = 60;

  /** Dashboard banner for a plan you have fallen behind, or '' when there is nothing to say. */
  function banner(plan, ev, guard) {
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
      // Catching up by cramming is how backlogs start, so when reviews are already piling up say so.
      if (guard && guard.sev >= 1) msg += ` <b>Don’t sprint to catch up while your reviews are piled up.</b> Clear them first; if the date stops being realistic, moving it beats burning out.`;
    }
    return `<div class="banner plan-banner">${msg}
      <div class="row" style="margin-top:8px"><a class="btn ghost small" href="#/plan">Open plan</a><button class="link" id="plan-dismiss" type="button">Dismiss for today</button></div></div>`;
  }


  /** Dashboard card for today: lessons done against the plan's daily number, and the reviews done against the day's total.
      d: { lessonsDone, lessonsQueue, reviewsDone, reviewsDue, reviewsTotal, acc }. reviewsTotal is worked out once a day
      (see Plan.reviewsToday), so the bar only moves forward as you review. '' when there is no plan to show. */
  function today(plan, d) {
    if (!plan) return '';
    const bar = (done, goal) => `<div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.min(done, goal)}"><i style="width:${goal ? Math.min(100, Math.round(done / goal * 100)) : 0}%"></i></div>`;
    const planGoal = plan.lpd ? Math.max(1, Math.round(plan.lpd)) : 0;
    const g = d.guard && d.guard.on ? d.guard : null;       // the workload guard's view of today (null when it is switched off)
    const goal = planGoal && g ? g.allowed : planGoal;       // today's safe amount: the plan's number, less while reviews are piled up
    const left = goal ? Math.max(0, goal - d.lessonsDone) : 0;
    const queue = d.lessonsQueue ? `${num(d.lessonsQueue)} waiting in your queue.` : 'Nothing in your queue right now.';
    let lessons;
    if (planGoal && g && g.paused) {
      lessons = `<div class="today-col"><div class="today-head"><b>Lessons</b><span>Paused for now</span></div>${bar(0, 1)}
          <small class="today-note">Your reviews are piled up, so lessons wait (the plan’s ${planGoal} a day resumes once they are under control). ${esc(g.note || '')}</small></div>`;
    } else if (planGoal) {
      const eased = g && g.eased ? ` Eased from the plan’s ${planGoal} while your reviews catch up.` : '';
      lessons = `<div class="today-col"><div class="today-head"><b>Lessons</b><span>${d.lessonsDone} of ${goal} today</span></div>${bar(d.lessonsDone, goal)}
          <small>${left ? `${num(left)} to go for today’s plan.` : 'Today’s lessons are done.'}${eased} ${queue}</small></div>`;
    } else {
      lessons = `<div class="today-col"><div class="today-head"><b>Lessons</b><span>${d.lessonsDone} done today</span></div>
          <small>${d.lessonsQueue ? `${num(d.lessonsQueue)} waiting in your queue. ` : ''}Open the plan and press “Update my plan” to get a daily lesson goal.</small></div>`;
    }

    const total = Math.max(0, d.reviewsTotal || 0);
    const over = d.reviewsDone > total;
    const head = over ? `${num(d.reviewsDone)} done today` : `${num(d.reviewsDone)} of ${num(total)} today`;
    const was = plan.acc != null ? plan.acc : Plan.DEFAULT_ACC;
    const load = plan.lpd && d.rpd ? d.rpd : plan.rpd;
    let note;
    if (d.acc != null && Math.abs(d.acc - was) >= 0.03 && plan.lpd) {
      note = ` Your accuracy is ${Math.round(d.acc * 100)}% (the plan assumed ${Math.round(was * 100)}%), so new lessons now bring about ${num(load)} reviews a day. Open the plan to update it.`;
    } else if (load) note = ` The plan averages about ${num(load)} reviews a day from new lessons, and more once older items come back.`;
    else note = '';
    const reviews = `<div class="today-col"><div class="today-head"><b>Reviews</b><span>${head}</span></div>${bar(d.reviewsDone, total || 1)}
          <small>${d.reviewsDue ? `${num(d.reviewsDue)} due now. Clear what’s due before starting new lessons, so reviews don’t pile up.` : 'You’re caught up on reviews.'}${over && total ? ` That’s ${num(d.reviewsDone - total)} more than were scheduled when the day began.` : ''}${note}</small></div>`;
    return `<div class="panel today"><div class="row between"><h2>Today’s plan</h2><a class="link" href="#/plan">Open plan</a></div><div class="today-cols">${lessons}${reviews}</div></div>`;
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
    let ls = null;           // your level history (time on the current level, finished levels)
    let acc = null;          // your answer accuracy (0..1) from WaniKani's review statistics, once known
    let cap = Guard.capacity({}, Date.now(), Guard.prefs().cap); // reviews a day you are comfortable with (worked out from your history once it loads)
    const now0 = Date.now();
    const st = { target: Math.min(MAX_LEVEL, Math.max(level + 1, saved ? saved.target : (level < 30 ? 30 : MAX_LEVEL))), end: 0 };
    st.end = saved ? saved.end : now0 + Plan.fastestDays(level, st.target) * 1.5 * DAY;

    const dayKey = (ms) => Stats.dayKey(new Date(ms));
    const items = (L) => (counts[L] != null ? counts[L] : Plan.DEFAULT_ITEMS);
    const pos = () => level + (frac || 0);
    const accUsed = () => (acc != null ? acc : Plan.DEFAULT_ACC);
    // Your own pace shapes how the time is shared out over the levels (needs at least one finished level).
    const curve = () => (pace && pace.n ? (L) => pace.byLevel(L).mean : null);
    const compute = (end) => Plan.make({ pos: pos(), target: st.target, end, now: Date.now(), items, behind: old.n, curve: curve(), bySize: exact(), acc: accUsed() });
    const exact = () => { for (let L = level; L < st.target; L++) if (counts[L] == null) return false; return true; };

    el.innerHTML = `<div class="wrap plan">
      <div class="greet"><h1>Plan</h1><p class="muted">Choose a level and a date. The dashboard tells you if you fall behind.</p></div>
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
      let extra = '';
      if (ev.state !== 'done' && pace && pace.n && ls) {
        const est = Stats.estimate({ level, target: saved.target, pace, elapsedDays: ls.elapsedDays, progress: frac, now: Date.now() });
        if (!est.already) extra += ` At your own pace you’d reach it around ${dateText(est.date)}${est.date > saved.end ? ', after your date' : ''}.`;
      }
      return `<p class="plan-saved ${ev.state}">${esc(head)} <b>${esc(line)}</b>${esc(extra)}</p>`;
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
      const guardOn = Guard.prefs().on;
      // The earliest date whose busiest weeks stay within what you can comfortably do. Same goal, lighter days.
      const comfy = guardOn ? Plan.endForPeak(compute, cap.value, p.earliest, now + 3000 * DAY) : null;

      const verdict = p.feasible ? '' : `<div class="banner">Quicker than WaniKani allows. The earliest for level ${st.target} is <b>${esc(dateText(p.earliest))}</b>, and the numbers below are for that date. <button class="link" id="use-earliest" type="button">Use that date</button></div>`;
      const canSave = p.feasible && frac != null;

      // One line on whether the busiest weeks fit what you manage.
      let sustain = '';
      if (guardOn) {
        const peak = p.reviewsPeak, ratio = peak / cap.value;
        const lvl = ratio <= 1.1 ? 'ok' : ratio <= 1.5 ? 'watch' : 'high';
        const text = lvl === 'ok'
          ? `Sustainable: the busiest weeks stay within your comfortable ${num(cap.value)} reviews a day.`
          : `Heavy: the busiest weeks reach about ${num(peak)} reviews a day, ${lvl === 'high' ? 'well ' : ''}above your comfortable ${num(cap.value)}. Plans like this are where backlogs begin.${comfy ? ` <button class="link" id="use-comfy" type="button">Use ${esc(dateText(comfy))}</button> to keep it comfortable.` : ' Consider a lower target level.'}`;
        sustain = `<p class="sustain ${lvl}">${text}</p>`;
      }

      $('#plan-out').innerHTML = `${verdict}
        <div class="panel"><h2>What it takes</h2>
          <div class="cards">
            <div class="card"><b>${r1(p.perLevel)}</b><span>days per level</span><small>${pace && pace.n ? `Yours so far: ${r1(pace.mean)} · ` : ''}fastest: ${r1(p.fastestPerLevel)}</small></div>
            <div class="card"><b>${num(p.lessonsPerDay)}</b><span>new lessons a day</span><small>${num(p.itemsLeft)} items${p.behind ? `, ${num(p.behind)} from earlier levels` : ''}</small></div>
            <div class="card"><b>~${num(p.reviewsAvg)}</b><span>reviews a day</span><small>Busiest weeks: ${num(p.reviewsPeak)}</small></div>
          </div>
          ${sustain}
          <div class="row" style="margin-top:10px">
            <button class="btn" id="plan-save" type="button"${canSave ? '' : ' disabled'}>${saved ? 'Update my plan' : 'Save as my plan'}</button>
            ${saved ? '<button class="btn ghost" id="plan-clear" type="button">Remove plan</button>' : ''}
          </div>
          <p class="fine">Reviews assume ${Math.round(p.acc * 100)}% accuracy${acc == null ? ' until yours is known' : ''} and count only items you haven’t started; reviews already in your queue come on top.${exact() ? '' : ' Item counts are estimates until each level has downloaded.'}</p>
        </div>
        <details class="panel"><summary><h2 style="display:inline">Level by level</h2></summary>
          <div class="plan-table"><table><thead><tr><th>Reach level</th><th>By</th></tr></thead><tbody>${p.milestones.map((m) => `<tr><td>${m.level}</td><td>${esc(dateText(m.date))}</td></tr>`).join('')}</tbody></table></div>
        </details>`;

      const ue = $('#use-earliest'); if (ue) ue.onclick = () => setEnd(endOfDay(dayKey(p.earliest)));
      const uc = $('#use-comfy'); if (uc) uc.onclick = () => setEnd(endOfDay(dayKey(comfy)));
      const sv = $('#plan-save');
      if (sv) sv.onclick = async () => {
        // A prompt, not a block: say plainly when the plan is much heavier than what you manage, then let the person decide.
        if (guardOn && p.reviewsPeak > cap.value * 1.15) {
          const ok = await UI.confirm({
            title: 'This plan is heavier than you usually manage',
            message: `At its busiest it brings about ${num(p.reviewsPeak)} reviews a day, against the ${num(cap.value)} you are comfortable with. Heavy plans are the most common way to end up with a backlog and quit.${comfy ? ` ${dateText(comfy)} would keep it comfortable.` : ''}`,
            ok: 'Save anyway', cancel: 'Go back',
          });
          if (!ok || dead) return;
        }
        saved = Object.assign({ target: st.target, end: st.end, start: Date.now(), startPos: level + frac, lpd: Math.round(p.lessonsPerDay * 10) / 10, rpd: Math.round(p.reviewsAvg), rpk: Math.round(p.reviewsPeak), acc: Math.round(p.acc * 1000) / 1000 }, Plan.shapeFields(p));
        Plan.save(uid, saved);
        if (window.Keep) Keep.request();
        o.toast('Plan saved. The dashboard will tell you if you fall behind. Settings has a backup file for it.');
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
      ls = Stats.levelStats(lp.rows, level, Date.now());
      pace = Stats.paceFor(ls.done, 'all');
      update();
    }).catch(() => {});
    // Your answer accuracy, from the saved review statistics, refreshed at most every half hour (the dashboard does the same).
    const takeAccuracy = (rs) => { if (dead || !rs) return; const a = Stats.accuracyOf(rs.rows); if (a != null && a !== acc) { acc = a; update(); } };
    Stats.savedReviewStats().then(takeAccuracy).catch(() => {});
    // What you comfortably manage, from the reviews you have done lately (used by the "Is it sustainable?" check).
    Stats.savedHistory().then((h) => { if (dead) return; cap = Guard.capacity(Stats.dayCounts(h), Date.now(), Guard.prefs().cap); update(); }).catch(() => {});
    Stats.syncReviewStats({}).then(takeAccuracy).catch(() => {});
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

  root.PlanView = { mount, banner, today };
})(window);
