/* The Plan screen and the dashboard's plan banner.
   A saved plan is locked: the screen shows it, how you stand against it and the dates it promised, and nothing on it
   can be changed by accident. The pencil opens an editor that puts the current plan and the updated one side by side,
   says in words what changes, and keeps the change in the plan's history, so an update can never quietly erase the
   fact that you were behind. With no saved plan the screen is the plain goal form.
   The dashboard banner speaks up when you are behind (by the clock or by the forecast), when a backlog explains the
   lateness, and when you are on schedule but the plan is faster than you have ever managed. */
(function (root) {
  'use strict';

  const DAY = 24 * 3600 * 1000;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateText = (ms) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  const r1 = (n) => Math.round(n * 10) / 10;
  const num = (n) => Math.round(n).toLocaleString();
  const posText = (p) => `level ${Math.floor(p)}, ${Math.round((p - Math.floor(p)) * 100)}% through`;
  const endOfDay = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 0).getTime(); };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  /** "about 3 days" / "about a day": lateness and earliness are always said in days, which mean the same for every plan. */
  const daysText = (n) => (n < 1.5 ? 'about a day' : `about ${plural(Math.round(n), 'day')}`);
  const MAX_LEVEL = 60;
  const PENCIL = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

  /** Dashboard banner for a plan you have fallen behind, or '' when there is nothing to say. */
  function banner(plan, ev, guard) {
    if (!ev || ev.state === 'done') return '';
    const head = `Plan: level ${plan.target} by ${dateText(plan.end)}`;
    const actions = '<div class="row" style="margin-top:8px"><a class="btn ghost small" href="#/plan">Open plan</a><button class="link" id="plan-dismiss" type="button">Dismiss for today</button></div>';
    const o = ev.outlook;
    let msg, cls = 'banner plan-banner';
    if (ev.state === 'on' || ev.state === 'ahead') {
      // On schedule, but the plan asks for a pace you have never kept: say so while there is still time to choose.
      if (!(o && o.risk === 'unrealistic')) return '';
      cls += ' info';
      msg = `<b>You’re on schedule, but your plan (level ${plan.target} by ${esc(dateText(plan.end))}) is much faster than your usual pace.</b> At your usual pace you’d reach level ${plan.target} around ${esc(dateText(o.date))}, ${daysText(o.lateDays)} after your date. A later date is easier to keep; the pencil on the plan screen shows the effect before you change anything.`;
    } else if (ev.state === 'late') {
      msg = `<b>${esc(head)} has passed.</b> You’re at level ${Math.floor(ev.pos)}. Open the plan and use the pencil to set a new date.`;
    } else if (ev.state === 'catchup') {
      cls += ' info';
      msg = `<b>You’re ${daysText(ev.behindDays)} behind your plan, and that fits the backlog you’re clearing.</b> ${plural(ev.backlog, 'lesson')} (radicals, kanji and vocabulary, from earlier levels or piled up on this one) ${ev.backlog === 1 ? 'is' : 'are'} still waiting (${plan.reserve > 0 ? `the plan set aside ${r1(plan.reserve)} days for them and they’re taking about ${daysText(ev.backlogDays).replace('about ', '')} more` : `about ${daysText(ev.backlogDays).replace('about ', '')} of lessons at the plan’s pace`}), so this is expected: a level or two at 1.3 to 2 times your normal time is part of clearing it, and there’s nothing to change yet. If you’re still behind once they’re done, that is your pace, and this will say so.`;
    } else {
      const lateBy = ev.behindDays != null ? ev.behindDays : null;
      if (lateBy != null) msg = `<b>You’re ${daysText(lateBy)} behind your plan.</b> `;
      else { const lv = Math.abs(ev.gap); msg = `<b>You’re ${lv < 1.05 ? 'about a level' : `about ${r1(lv)} levels`} behind your plan.</b> `; }
      if (ev.reason === 'forecast' && ev.eta != null && ev.plannedNext != null) {
        msg += `Even if every review goes right, level ${ev.nextLevel} can’t come before ${esc(dateText(ev.eta))}${ev.etaExact ? '' : ' (once the rest of its kanji are started)'}; the plan has it on ${esc(dateText(ev.plannedNext))}. `;
      } else msg += `${esc(head)} has you at ${posText(ev.expected)} by now; you’re at ${posText(ev.pos)}. `;
      if (ev.backlog > 0) msg += `Some of that is the ${plural(ev.backlog, 'lesson')} still waiting (from earlier levels or piled up on this one). `;
      else if (ev.backlogCleared) msg += `Your backlog is cleared, so this is your pace, not the backlog. `;
      msg += ev.impossible
        ? `That date is now quicker than WaniKani allows (earliest: ${dateText(ev.earliest)}), so consider moving it.`
        : `To still make it, aim for about ${r1(ev.neededPerLevel)} days per level (the plan assumed ${r1(ev.plannedPerLevel)}).`;
      // Catching up by cramming is how backlogs start, so when reviews are already piling up say so.
      if (guard && guard.sev >= 1) msg += ` <b>Don’t sprint to catch up while your reviews are piled up.</b> Clear them first; if the date stops being realistic, moving it beats burning out.`;
    }
    return `<div class="${cls}">${msg}${actions}</div>`;
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
          <small class="today-note">Your reviews are heavy right now, so lessons wait (the plan’s ${planGoal} a day resumes once they ease). ${esc(g.note || '')}</small></div>`;
    } else if (planGoal) {
      const eased = g && g.eased ? ` Held to ${goal} because of the reviews already scheduled for the coming days (the plan asks for ${planGoal}).` : '';
      lessons = `<div class="today-col"><div class="today-head"><b>Lessons</b><span>${left ? `${d.lessonsDone} of ${goal} today` : `${d.lessonsDone} today`}</span></div>${bar(d.lessonsDone, goal)}
          <small data-min="2">${left ? `${num(left)} to go for today’s plan.` : 'Today’s lessons are done.'}${eased} ${queue}</small></div>`;
    } else {
      lessons = `<div class="today-col"><div class="today-head"><b>Lessons</b><span>${d.lessonsDone} done today</span></div>
          <small data-min="2">${d.lessonsQueue ? `${num(d.lessonsQueue)} waiting in your queue. ` : ''}Open the plan and use the pencil to refresh it, which gives it a daily lesson goal.</small></div>`;
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
          <small data-min="2">${d.reviewsDue ? `${num(d.reviewsDue)} due now. Clear what’s due before starting new lessons, so reviews don’t pile up.` : 'You’re caught up on reviews.'}${over && total ? ` That’s ${num(d.reviewsDone - total)} more than were scheduled when the day began.` : ''}${note}</small></div>`;
    return `<div class="panel today"><div class="row between"><h2>Today’s plan</h2><a class="link" href="#/plan">Open plan</a></div><div class="today-cols">${lessons}${reviews}</div></div>`;
  }

  // ---- lessons still waiting from levels below yours (shared by the plan screen and the dashboard) ----
  // You can be on level 14 with level 12 vocabulary waiting. Those lessons are real work the plan did not count on, so
  // they size the workload (`n`: every item of those levels not started yet, once the level is saved on this device,
  // otherwise just what is in the queue). `queued` is the lessons you can do right now and `gate` the part of those
  // that are radicals and kanji. Only `gate` can excuse lateness: those are the lessons that compete with the current
  // level's own kanji, while vocabulary never holds up a level-up, so a vocabulary backlog explains nothing.
  let blCache = null;
  async function backlog(level) {
    if (blCache && blCache.level === level && Date.now() - blCache.at < 60000) return blCache.val;
    let out = { n: 0, queued: 0, gate: 0, from: 0, cur: 0, curGate: 0 };
    try {
      await Local.ready;
      const queue = Local.lessonsAvailable();
      if (queue.length) {
        const subs = await api.getSubjects(queue.map((a) => a.data.subject_id), { background: true });
        const queued = {}, gated = {};
        queue.forEach((a) => {
          const sj = subs.get(a.data.subject_id);
          if (!sj || sj.data.level >= level || sj.data.hidden_at) return;
          queued[sj.data.level] = (queued[sj.data.level] || 0) + 1;
          if (sj.object === 'radical' || sj.object === 'kanji') gated[sj.data.level] = (gated[sj.data.level] || 0) + 1;
        });
        const lows = Object.keys(queued).map(Number).sort((a, b) => a - b);
        if (lows.length) {
          let n = 0, q = 0, g = 0;
          for (let L = lows[0]; L < level; L++) {
            q += queued[L] || 0; g += gated[L] || 0;
            if (Local.levelDone(L)) {
              const all = await Local.levelSubjects(L, { background: true });
              n += all.filter((s) => { if (s.data.hidden_at) return false; const a = Local.assignmentFor(s.id); return !(a && a.data.started_at); }).length;
            } else n += queued[L] || 0;
          }
          out = { n, queued: q, gate: g, from: lows[0], cur: 0, curGate: 0 };
        }
        // Lessons waiting on the level you are on. Normal while they are a day's worth; owed once they pile up.
        queue.forEach((a) => {
          const sj = subs.get(a.data.subject_id);
          if (!sj || sj.data.level !== level || sj.data.hidden_at) return;
          out.cur++;
          if (sj.object === 'radical' || sj.object === 'kanji') out.curGate++;
        });
      }
    } catch (e) { /* the plan works without it */ }
    blCache = { level, at: Date.now(), val: out };
    return out;
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
    let mode = saved ? 'view' : 'new'; // view: the locked plan · edit: the pencil's editor · new: no plan yet
    const counts = {};       // level -> items still to learn there (exact, once that level has been downloaded)
    let old = { n: 0, queued: 0, gate: 0, from: 0, cur: 0, curGate: 0 }; // lessons still waiting from levels below yours
    let frac = null;         // how far through the current level you are, once known
    let levelInfo = null;    // Plan.levelStatus of the current level (earliest level-up date and so on)
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
    const exact = (target) => { for (let L = level; L < target; L++) if (counts[L] == null) return false; return true; };
    // The plan is upfront about a backlog: the lessons of every kind (radicals, kanji and vocabulary) waiting from earlier
    // levels are an up-front, one-time cost, so the days they take (at the lessons a day this plan asks for) are set aside before the levels
    // begin, instead of making the first level look late. At most half the time you give is ever set aside.
    const compute = (end, target) => {
      const T = target || st.target;
      const args = { pos: pos(), target: T, end, now: Date.now(), items, behind: old.n, curve: curve(), bySize: exact(T), acc: accUsed() };
      const first = Plan.make(args);
      const owedCount = first.done ? 0 : Plan.owed(old.queued, old.cur, first.lessonsPerDay);
      if (first.done || !(owedCount > 0)) return first;
      const reserve = Math.min(owedCount / Math.max(first.lessonsPerDay, 1), Math.max(0, (end - Date.now()) / DAY) / 2);
      return Plan.make(Object.assign(args, { reserve }));
    };
    /** The up-front notice about lessons waiting from earlier levels (empty when there are none). `reserve` is the days set aside. */
    const backlogNotice = (reserve, lpd) => {
      const extra = Math.max(0, old.cur - Math.ceil(lpd > 0 ? lpd : 0)); // this level's lessons beyond a day's worth
      const owedN = old.queued + extra;
      const locked = Math.max(0, old.n - old.queued); // earlier-level items not unlocked yet: not owed, but still ahead of you
      if (!(owedN > 0) && !(locked > 0)) return '';
      const parts = [];
      if (owedN > 0) {
        const rk = old.gate, vocab = old.queued - old.gate;
        const where = [old.queued > 0 ? `${plural(old.queued, 'lesson')}${rk > 0 && vocab > 0 ? ` (${num(rk)} radical and kanji, ${num(vocab)} vocabulary)` : ''} from earlier levels` : '', extra > 0 ? `${plural(extra, 'lesson')} on this level beyond a day’s worth` : ''].filter(Boolean).join(' and ');
        const one = owedN === 1;
        parts.push(`You have ${where} waiting. Vocabulary counts as much as radicals and kanji, so all of them are in the plan. That is an up-front, one-time cost, not your pace: ${reserve > 0 ? `the plan sets aside about ${r1(reserve)} days at the start to clear ${one ? 'it' : 'them'} (at the lessons a day this plan asks for), so the days per level shown are for the levels after that. A level or two at 1.3 to 2 times your normal time is expected while you clear ${one ? 'it' : 'them'}` : 'it is too large a share of this plan’s time to set aside, so expect the first level to run long'}.`);
      }
      if (locked > 0) parts.push(`${plural(locked, 'item')} from earlier levels ${locked === 1 ? 'is' : 'are'} not unlocked yet. ${locked === 1 ? 'It isn’t' : 'They aren’t'} counted as backlog, since you can’t do ${locked === 1 ? 'it' : 'them'} yet, but ${locked === 1 ? 'it is' : 'they are'} in the lessons a day and reviews the plan expects.`);
      return `<p class="sustain watch backlog-note">${esc(parts.join(' '))}</p>`;
    };
    // How long your own pace says it takes to reach `target` (null until your finished levels and progress are known).
    const estFor = (target) => (pace && pace.n && ls && frac != null && target > level
      ? Stats.estimate({ level, target, pace, elapsedDays: ls.elapsedDays, progress: frac, now: Date.now() }) : null);
    const evalSaved = () => (saved && frac != null
      ? Plan.evaluate(saved, pos(), Date.now(), { eta: levelInfo ? levelInfo.eta : null, etaExact: levelInfo ? levelInfo.exact : true, backlog: old.queued, current: old.cur, est: estFor(saved.target) })
      : null);
    const diffText = (d) => (Math.abs(d) < 1 ? 'on time' : `${plural(Math.round(Math.abs(d)), 'day')} ${d > 0 ? 'late' : 'early'}`);
    const diffCls = (d) => (Math.abs(d) < 1 ? '' : d > 0 ? ' late' : ' early');

    el.innerHTML = `<div class="wrap plan">
      <div class="greet"><h1>Plan</h1><p class="muted" id="plan-sub"></p></div>
      <div id="plan-main"></div>
    </div>`;
    const $ = (s) => el.querySelector(s);

    function draw() {
      if (dead) return;
      $('#plan-sub').textContent = mode === 'view' ? 'Your saved plan. To change it, use the pencil: you’ll see the old and new plan side by side first.'
        : mode === 'edit' ? 'Check the change below. Nothing is saved until you press Save changes.'
        : 'Choose a level and a date. The dashboard tells you if you fall behind.';
      if (mode === 'view') drawView(); else drawEditor();
    }
    const refresh = () => { if (dead) return; if (mode === 'view') drawView(); else update(); };

    // ------------------------------------------------------------------ the locked plan
    function statusHTML(ev) {
      if (!saved || !ev) return '';
      const head = `Level ${saved.target} by ${dateText(saved.end)}.`;
      let line;
      if (ev.state === 'done') line = 'You’ve reached that level.';
      else if (ev.state === 'late') line = 'The date has passed. Use the pencil to set a new one.';
      else if (ev.state === 'behind') line = `You’re ${daysText(ev.behindDays)} behind.`;
      else if (ev.state === 'catchup') line = `You’re ${daysText(ev.behindDays)} behind, which fits the ${plural(ev.backlog, 'lesson')} you’re still clearing.`;
      else if (ev.state === 'ahead') line = `You’re ${daysText(ev.gapDays)} ahead.`;
      else line = 'You’re on schedule.';
      let extra = '', risky = '';
      const oc = ev.outlook;
      if (ev.state !== 'done' && ev.state !== 'late' && oc && oc.risk !== 'ok') {
        risky = oc.risk === 'unrealistic' ? ' risky' : ' tight';
        extra = oc.risk === 'unrealistic'
          ? ` But at your usual pace you’d reach level ${saved.target} around ${dateText(oc.date)}, ${daysText(oc.lateDays)} after your date, so keeping to this plan means going about ${r1(oc.ratio)} times faster than you usually do.`
          : ` Your usual pace would reach it around ${dateText(oc.date)}, a little after your date; only your quicker levels would make it.`;
      } else if (ev.state !== 'done' && oc && oc.risk === 'ok') extra = ' Your usual pace would get there in time.';
      return `<p class="plan-saved ${ev.state}${risky}">${esc(head)} <b>${esc(line)}</b>${esc(extra)}</p>`;
    }

    function drawView() {
      const now = Date.now();
      const ev = evalSaved();
      const dr = Plan.drift(saved);
      const sched = Plan.scheduleOf(saved);
      const c = frac != null && saved.end > now ? compute(saved.end, saved.target) : null; // what keeping this date takes from today
      const planned = ((saved.end - saved.start) / DAY - (saved.reserve || 0)) / (saved.target - saved.startPos);
      const was = dr.origin
        ? `First saved ${dateText(dr.origin.start)} as level ${dr.origin.target} by ${dateText(dr.origin.end)}. Changed ${plural(dr.n, 'time')}${Math.abs(dr.days) >= 0.5 ? `; the date has moved ${plural(Math.round(Math.abs(dr.days)), 'day')} ${dr.days > 0 ? 'later' : 'earlier'} in total` : ''}.`
        : `Saved ${dateText(saved.start)}, from level ${Math.floor(saved.startPos)}, ${Math.round((saved.startPos - Math.floor(saved.startPos)) * 100)}% through.`;
      const revs = (saved.revs || []).slice().reverse().map((r) => {
        const gd = r.gapDays == null ? '' : Math.abs(r.gapDays) < 1 ? ', you were on schedule' : `, you were ${daysText(Math.abs(r.gapDays))} ${r.gapDays < 0 ? 'behind' : 'ahead'}`;
        return `<li>${esc(dateText(r.at))}: ${r.fromTarget === r.toTarget ? `level ${r.toTarget}` : `level ${r.fromTarget} → ${r.toTarget}`}, ${esc(dateText(r.fromEnd))} → ${esc(dateText(r.toEnd))}${esc(gd)}.</li>`;
      }).join('');

      // where you stand today, in plain rows
      const rows = [];
      if (ev && ev.state !== 'done') {
        rows.push(['The plan has you at', posText(ev.expected)]);
        rows.push(['You’re at', posText(ev.pos)]);
        if (levelInfo && levelInfo.eta != null && ev.plannedNext != null) {
          const d = (levelInfo.eta - ev.plannedNext) / DAY;
          const when = levelInfo.ready ? 'now: the kanji you need are at Guru' : dateText(levelInfo.eta);
          rows.push([`Earliest level ${ev.nextLevel}`, `${when}${levelInfo.ready ? '' : levelInfo.exact ? '' : ' (once the rest of its kanji are started)'}; the plan has ${dateText(ev.plannedNext)}${d >= 1 ? `, so at least ${plural(Math.round(d), 'day')} late` : ''}`]);
        } else if (levelInfo && levelInfo.eta == null && levelInfo.need) rows.push([`Earliest level ${level + 1}`, 'not known yet: some of the kanji you need are still locked']);
        const allowed = Plan.daysFor(saved, level);
        if (ls && ls.since && allowed) rows.push(['Time on this level', `${plural(Math.round(ls.elapsedDays), 'day')}; the plan allows about ${Math.round(allowed)}`]);
        if (saved.reserve > 0) rows.push(['Set aside for the backlog', `about ${r1(saved.reserve)} days at the start of the plan, one time; the days per level below are for the levels after it`]);
        {
          const extra = Math.max(0, old.cur - Math.ceil(saved.lpd || 0)), locked = Math.max(0, old.n - old.queued);
          if (old.queued > 0) rows.push(['Lessons from earlier levels', `${num(old.queued)} waiting (${num(old.gate)} radical and kanji, ${num(old.queued - old.gate)} vocabulary), about ${r1(old.queued / (saved.lpd || 1))} days of lessons at the plan’s pace; all of them count towards the plan`]);
          if (extra > 0) rows.push(['Lessons piling up on this level', `${num(old.cur)} waiting, ${num(extra)} more than a day’s worth; counted as owed so you aren’t shown ahead while they wait`]);
          if (locked > 0) rows.push(['Not unlocked yet', `${num(locked)} items from earlier levels; in the plan’s workload, not counted as backlog until you can do them`]);
        }
      }
      const where = rows.length ? `<dl class="plan-where">${rows.map((r) => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>` : (frac == null ? '<p class="fine">Working out where you are…</p>' : '');

      // levels, as promised and as they have gone
      const est = estFor(saved.target);
      const tableRows = sched.map((m) => {
        const reached = ls && ls.reachedAt(m.level);
        let actual = '', diff = '', cls = '';
        if (reached) { const d = (reached - m.date) / DAY; actual = dateText(reached); diff = diffText(d); cls = diffCls(d); }
        else if (m.level === level + 1 && levelInfo && levelInfo.eta != null && !levelInfo.ready) {
          const d = (levelInfo.eta - m.date) / DAY; actual = `earliest ${dateText(levelInfo.eta)}`; diff = d >= 1 ? `at least ${plural(Math.round(d), 'day')} late` : 'on time so far'; cls = d >= 1 ? ' late' : '';
        } else if (est) {
          const pt = est.path.find((x) => x.level === m.level);
          if (pt) { const d = (pt.date - m.date) / DAY; actual = `about ${dateText(pt.date)} at your pace`; diff = diffText(d); cls = diffCls(d); }
        }
        return `<tr><td>${m.level}</td><td>${esc(dateText(m.date))}</td><td>${esc(actual)}</td><td class="${cls.trim()}">${esc(diff)}</td></tr>`;
      }).join('');

      $('#plan-main').innerHTML = `
        <div class="panel plan-locked">
          <div class="row between"><h2>Your plan</h2><button class="icon-btn" id="plan-edit" type="button" aria-label="Edit plan" title="Edit plan">${PENCIL}</button></div>
          ${ev ? statusHTML(ev) : `<p class="plan-saved"><b>Level ${saved.target} by ${esc(dateText(saved.end))}.</b></p>`}
          ${where}
          <p class="fine">${esc(was)} The plan is locked: changes go through the pencil, which shows the old and new plan together before anything is saved.</p>
          ${revs ? `<details class="plan-history"><summary>History of changes</summary><ul>${revs}</ul></details>` : ''}
        </div>
        <div class="panel"><h2>What it asks of you</h2>
          <div class="cards">
            <div class="card"><b>${r1(planned)}</b><span>days per level</span><small>${c ? `From today: ${r1(c.perLevel)}` : `As saved on ${esc(dateText(saved.start))}`}</small></div>
            <div class="card"><b>${saved.lpd ? num(saved.lpd) : '–'}</b><span>new lessons a day</span><small>${c ? `From today: ${num(c.lessonsPerDay)}` : 'As saved'}</small></div>
            <div class="card"><b>${saved.rpd ? '~' + num(saved.rpd) : '–'}</b><span>reviews a day</span><small>${saved.rpk ? `Busiest weeks: ${num(saved.rpk)}` : ''}</small></div>
          </div>
          <p class="fine">The first figure of each card is what the plan was saved with. “From today” is what keeping the same date takes now, from where you are.</p>
          <div class="row" style="margin-top:10px"><button class="btn ghost" id="plan-clear" type="button">Remove plan</button></div>
        </div>
        <details class="panel" open><summary><h2 style="display:inline">Level by level</h2></summary>
          <div class="plan-table"><table><thead><tr><th>Reach level</th><th>Plan</th><th>Actual or forecast</th><th>Difference</th></tr></thead><tbody>${tableRows}</tbody></table></div>
          <p class="fine">Plan dates are the ones saved; they don’t move as you go. Forecasts after the next level use your usual pace.</p>
        </details>`;
      $('#plan-edit').onclick = () => { mode = 'edit'; st.target = saved.target; st.end = saved.end; fill(Math.max(st.target, saved.target)); draw(); };
      $('#plan-clear').onclick = async () => {
        const ok = await UI.confirm({ title: 'Remove your plan?', message: 'The dashboard will stop comparing you with it, and its history of changes is deleted too.', ok: 'Remove', danger: true });
        if (ok && !dead) { Plan.clear(); saved = null; mode = 'new'; o.toast('Plan removed.'); draw(); }
      };
    }

    // ------------------------------------------------------------------ the editor (new plan, or the pencil)
    function drawEditor() {
      $('#plan-main').innerHTML = `
        <div class="panel"><div class="row between"><h2>${mode === 'edit' ? 'Edit your plan' : 'Your goal'}</h2>${mode === 'edit' ? '<button class="btn ghost small" id="plan-cancel" type="button">Cancel</button>' : ''}</div>
          <div class="plan-form">
            <div class="field"><label for="p-target">Reach level</label>${UI.stepperHTML('p-target', st.target, { min: level + 1, max: MAX_LEVEL, step: 1, label: 'Target level' })}</div>
            <div class="field"><label for="p-end">By</label><input type="date" id="p-end" class="datein" value="${dayKey(st.end)}"></div>
          </div>
        </div>
        <div id="plan-out"></div>`;
      const endInput = $('#p-end');
      UI.bindStepper($('#p-target').closest('[data-stepper]'), (v) => { st.target = v; update(); fill(Math.max(st.target, saved ? saved.target : 0)); });
      endInput.onchange = () => { if (endInput.value) { st.end = endOfDay(endInput.value); update(); } };
      const cn = $('#plan-cancel'); if (cn) cn.onclick = leaveEditor;
      update();
    }
    function leaveEditor() { mode = 'view'; st.target = saved.target; st.end = saved.end; draw(); }
    const setEnd = (ms) => { st.end = ms; const i = $('#p-end'); if (i) i.value = dayKey(ms); update(); };

    /** One line on whether the plan is realistic at your own pace, with a way to a date that is. */
    function realismHTML(end) {
      const e = estFor(st.target);
      const oc = e ? Plan.outlook({ end }, e) : null;
      if (!oc) return { html: '', oc: null };
      const usual = `${r1(pace.mean)} days per level`;
      let cls, text;
      if (oc.risk === 'ok') { cls = 'ok'; text = `Realistic: at your usual pace (${usual}) you’d get there in time.`; }
      else if (oc.risk === 'tight') { cls = 'watch'; text = `Ambitious: only your quicker levels get you there by this date. At your usual pace (${usual}) you’d arrive around ${dateText(oc.date)}.`; }
      else { cls = 'high'; text = `Very ambitious: this needs about ${r1(oc.ratio)} times your usual speed. At your usual pace (${usual}) you’d reach level ${st.target} around ${dateText(oc.date)}, ${daysText(oc.lateDays)} later. Plans like this tend to be missed. <button class="link" id="use-pace" type="button">Use ${esc(dateText(oc.date))}</button> for a date that matches how you actually go.`; }
      return { html: `<p class="sustain ${cls}">${text}</p>`, oc };
    }

    function update() {
      if (dead || mode === 'view') return;
      const out = $('#plan-out');
      if (!out) return;
      const now = Date.now();
      if (st.end <= now) { out.innerHTML = '<div class="panel"><p class="error">Pick a date after today.</p></div>'; return; }
      const p = compute(st.end);
      const guardOn = Guard.prefs().on;
      // The earliest date whose busiest weeks stay within what you can comfortably do. Same goal, lighter days.
      const comfy = guardOn ? Plan.endForPeak((e) => compute(e), cap.value, p.earliest, now + 3000 * DAY) : null;
      const verdict = p.feasible ? '' : `<div class="banner">Quicker than WaniKani allows. The earliest for level ${st.target} is <b>${esc(dateText(p.earliest))}</b>, and the numbers below are for that date. <button class="link" id="use-earliest" type="button">Use that date</button></div>`;
      const edit = mode === 'edit' && saved;
      const changed = !edit || st.target !== saved.target || dayKey(st.end) !== dayKey(saved.end);
      const canSave = p.feasible && frac != null && changed;

      let sustain = '', heavy = false;
      if (guardOn) {
        const peak = p.reviewsPeak, ratio = peak / cap.value;
        const lvl = ratio <= 1.1 ? 'ok' : ratio <= 1.5 ? 'watch' : 'high';
        heavy = peak > cap.value * 1.15;
        const text = lvl === 'ok'
          ? `Sustainable: the busiest weeks stay within your comfortable ${num(cap.value)} reviews a day.`
          : `Heavy: the busiest weeks reach about ${num(peak)} reviews a day, ${lvl === 'high' ? 'well ' : ''}above your comfortable ${num(cap.value)}. Plans like this are where backlogs begin.${comfy ? ` <button class="link" id="use-comfy" type="button">Use ${esc(dateText(comfy))}</button> to keep it comfortable.` : ' Consider a lower target level.'}`;
        sustain = `<p class="sustain ${lvl}">${text}</p>`;
      }
      const real = realismHTML(st.end);
      const fine = `<p class="fine">Reviews assume ${Math.round(p.acc * 100)}% accuracy${acc == null ? ' until yours is known' : ''} and count only items you haven’t started; reviews already in your queue come on top.${exact(st.target) ? '' : ' Item counts are estimates until each level has downloaded.'}</p>`;

      let main;
      if (!edit) {
        main = `<div class="panel"><h2>What it takes</h2>
          <div class="cards">
            <div class="card"><b>${r1(p.perLevel)}</b><span>days per level</span><small>${pace && pace.n ? `Yours so far: ${r1(pace.mean)} · ` : ''}fastest: ${r1(p.fastestPerLevel)}${p.reserve > 0 ? ` · after ${r1(p.reserve)} days for the backlog` : ''}</small></div>
            <div class="card"><b>${num(p.lessonsPerDay)}</b><span>new lessons a day</span><small>${num(p.itemsLeft)} items${p.behind ? `, ${num(p.behind)} from earlier levels` : ''}</small></div>
            <div class="card"><b>~${num(p.reviewsAvg)}</b><span>reviews a day</span><small>Busiest weeks: ${num(p.reviewsPeak)}</small></div>
          </div>
          ${backlogNotice(p.reserve, p.lessonsPerDay)}${sustain}${real.html}
          <div class="row" style="margin-top:10px"><button class="btn" id="plan-save" type="button"${canSave ? '' : ' disabled'}>Save as my plan</button></div>
          ${fine}
        </div>
        <details class="panel"><summary><h2 style="display:inline">Level by level</h2></summary>
          <div class="plan-table"><table><thead><tr><th>Reach level</th><th>By</th><th>Days</th></tr></thead><tbody>${p.milestones.map((m, i) => `<tr><td>${m.level}</td><td>${esc(dateText(m.date))}</td><td>${r1((m.date - (i ? p.milestones[i - 1].date : now)) / DAY)}</td></tr>`).join('')}</tbody></table></div>
        </details>`;
      } else {
        const cur = saved.end > now ? compute(saved.end, saved.target) : null;
        const ev = evalSaved();
        const dr = Plan.drift(saved);
        const orig = dr.origin || { target: saved.target, end: saved.end };
        const cell = (a, b, fmt) => `<td>${fmt(a)}</td><td class="${r1(a) !== r1(b) ? 'chg' : ''}">${fmt(b)}</td>`;
        const goalChg = st.target !== saved.target || dayKey(st.end) !== dayKey(saved.end);
        const cmp = `<table class="plan-cmp"><thead><tr><th></th><th>Current plan</th><th>Updated plan</th></tr></thead><tbody>
          <tr><th scope="row">Goal</th><td>Level ${saved.target} by ${esc(dateText(saved.end))}</td><td class="${goalChg ? 'chg' : ''}">Level ${st.target} by ${esc(dateText(st.end))}</td></tr>
          ${cur && (cur.reserve > 0 || p.reserve > 0) ? `<tr><th scope="row">Set aside for backlog</th>${cell(cur.reserve, p.reserve, (v) => (v > 0 ? `about ${r1(v)} days` : 'none'))}</tr>` : ''}
          ${cur ? `<tr><th scope="row">Days per level</th>${cell(cur.perLevel, p.perLevel, (v) => r1(v))}</tr>
          <tr><th scope="row">New lessons a day</th>${cell(cur.lessonsPerDay, p.lessonsPerDay, (v) => num(v))}</tr>
          <tr><th scope="row">Reviews a day</th>${cell(cur.reviewsAvg, p.reviewsAvg, (v) => '~' + num(v))}</tr>
          <tr><th scope="row">Busiest weeks</th>${cell(cur.reviewsPeak, p.reviewsPeak, (v) => num(v))}</tr>` : `<tr><th scope="row">Days per level</th><td>${r1(((saved.end - saved.start) / DAY - (saved.reserve || 0)) / (saved.target - saved.startPos))}</td><td>${r1(p.perLevel)}</td></tr>`}
          </tbody></table>`;

        const li = [];
        if (!changed) li.push('No changes yet. Change the level or the date above to see what it does.');
        else {
          const dEnd = (st.end - saved.end) / DAY;
          if (st.target !== saved.target) li.push(`The goal moves from level ${saved.target} to level ${st.target}.`);
          if (dayKey(st.end) !== dayKey(saved.end)) li.push(`The date moves from ${dateText(saved.end)} to ${dateText(st.end)}, ${plural(Math.max(1, Math.round(Math.abs(dEnd))), 'day')} ${dEnd > 0 ? 'later' : 'earlier'}.`);
          if (cur) li.push(`Days per level go from ${r1(cur.perLevel)} to ${r1(p.perLevel)}, new lessons a day from ${num(cur.lessonsPerDay)} to ${num(p.lessonsPerDay)}, and reviews a day from about ${num(cur.reviewsAvg)} to about ${num(p.reviewsAvg)}. Both columns are worked out from where you are today.`);
          if (ev && (ev.state === 'behind' || ev.state === 'catchup')) li.push(`Right now you’re ${daysText(ev.behindDays)} behind the current plan. The updated plan starts from where you are today (${posText(pos())}), so that lateness stops counting against you, but it stays in the plan’s history.`);
          else if (ev && ev.state === 'late') li.push(`The current plan’s date has passed. The updated plan starts from where you are today (${posText(pos())}).`);
          else if (ev) li.push(`You’re ${ev.state === 'ahead' ? 'ahead of' : 'on schedule with'} the current plan. The updated plan starts from where you are today (${posText(pos())}).`);
          const after = (st.end - orig.end) / DAY;
          li.push(`This will be change ${dr.n + 1} to this plan. Against the first version (level ${orig.target} by ${dateText(orig.end)}) the date ${Math.abs(after) < 0.5 && st.target === orig.target ? 'would be the same.' : `would be ${st.target !== orig.target ? `level ${st.target} by ${dateText(st.end)}` : `${plural(Math.round(Math.abs(after)), 'day')} ${after > 0 ? 'later' : 'earlier'}`}.`}`);
        }
        const sched = Plan.scheduleOf(saved);
        const levels = new Map();
        sched.forEach((m) => levels.set(m.level, { cur: m.date }));
        p.milestones.forEach((m) => { const x = levels.get(m.level) || {}; x.next = m.date; levels.set(m.level, x); });
        const lrows = [...levels.entries()].sort((a, b) => a[0] - b[0]).map(([L, x]) => {
          const d = x.cur != null && x.next != null ? (x.next - x.cur) / DAY : null;
          return `<tr><td>${L}</td><td>${x.cur != null ? esc(dateText(x.cur)) : '–'}</td><td>${x.next != null ? esc(dateText(x.next)) : '–'}</td><td class="${d != null && Math.abs(d) >= 1 ? (d > 0 ? 'late' : 'early') : ''}">${d == null ? '' : Math.abs(d) < 1 ? 'same' : `${plural(Math.round(Math.abs(d)), 'day')} ${d > 0 ? 'later' : 'earlier'}`}</td></tr>`;
        }).join('');
        main = `<div class="panel"><h2>Current plan and updated plan</h2>
          <div class="plan-compare">${cmp}</div>
          <ul class="plan-changes">${li.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
          ${backlogNotice(p.reserve, p.lessonsPerDay)}${sustain}${real.html}
          <div class="row" style="margin-top:10px"><button class="btn" id="plan-save" type="button"${canSave ? '' : ' disabled'}>Save changes</button><button class="btn ghost" id="plan-cancel2" type="button">Cancel</button></div>
          ${fine}
        </div>
        <details class="panel"><summary><h2 style="display:inline">Level by level, before and after</h2></summary>
          <div class="plan-table"><table><thead><tr><th>Reach level</th><th>Current plan</th><th>Updated plan</th><th>Change</th></tr></thead><tbody>${lrows}</tbody></table></div>
          <p class="fine">The current plan’s dates are the ones saved; the updated plan’s are worked out from today.</p>
        </details>`;
      }
      out.innerHTML = `${verdict}${main}`;

      const ue = $('#use-earliest'); if (ue) ue.onclick = () => setEnd(endOfDay(dayKey(p.earliest)));
      const uc = $('#use-comfy'); if (uc) uc.onclick = () => setEnd(endOfDay(dayKey(comfy)));
      const up = $('#use-pace'); if (up) up.onclick = () => setEnd(endOfDay(dayKey(real.oc.date)));
      const c2 = $('#plan-cancel2'); if (c2) c2.onclick = leaveEditor;
      const sv = $('#plan-save');
      if (sv) sv.onclick = async () => {
        // A prompt, not a block: say plainly when the plan is heavy or faster than you have ever gone, then let the person decide.
        const issues = [];
        if (guardOn && heavy) issues.push(`At its busiest it brings about ${num(p.reviewsPeak)} reviews a day, against the ${num(cap.value)} you are comfortable with.${comfy ? ` ${dateText(comfy)} would keep it comfortable.` : ''}`);
        if (real.oc && real.oc.risk === 'unrealistic') issues.push(`It needs about ${r1(real.oc.ratio)} times your usual speed: at your usual pace you’d reach level ${st.target} around ${dateText(real.oc.date)}.`);
        if (issues.length) {
          const ok = await UI.confirm({
            title: heavy && real.oc && real.oc.risk === 'unrealistic' ? 'This plan is heavy and faster than you usually go' : heavy ? 'This plan is heavier than you usually manage' : 'This plan is faster than you usually go',
            message: `${issues.join(' ')} Plans like this are the most common way to end up with a backlog and quit.`,
            ok: 'Save anyway', cancel: 'Go back',
          });
          if (!ok || dead) return;
        }
        const made = { target: st.target, end: st.end, start: Date.now(), startPos: level + frac, lpd: Math.round(p.lessonsPerDay * 10) / 10, rpd: Math.round(p.reviewsAvg), rpk: Math.round(p.reviewsPeak), acc: Math.round(p.acc * 1000) / 1000, reserve: Math.round((p.reserve || 0) * 10) / 10 };
        Object.assign(made, Plan.shapeFields(p));
        if (edit) {
          const ev = evalSaved();
          Plan.revise(uid, saved, made, { pos: pos(), gapDays: ev ? (ev.behindDays >= 0 ? -ev.behindDays : ev.gapDays) : null });
        } else Plan.save(uid, made);
        saved = Plan.load(uid);
        if (window.Keep) Keep.request();
        o.toast(edit ? 'Plan updated. The change is kept in its history.' : 'Plan saved. It’s now locked; the pencil changes it. The dashboard will tell you if you fall behind.');
        mode = 'view';
        draw();
      };
    }

    draw();

    // Your own pace (from finished levels) and the real number of items per level, filled in as they become known.
    Stats.savedProgressions().then((lp) => {
      if (dead || !lp) return;
      ls = Stats.levelStats(lp.rows, level, Date.now());
      pace = Stats.paceFor(ls.done, localStorage.getItem('kl_pace_basis') || 'all', Number(localStorage.getItem('kl_pace_custom')) || 12);
      refresh();
    }).catch(() => {});
    // Your answer accuracy, from the saved review statistics, refreshed at most every half hour (the dashboard does the same).
    const takeAccuracy = (rs) => { if (dead || !rs) return; const a = Stats.accuracyOf(rs.rows); if (a != null && a !== acc) { acc = a; refresh(); } };
    Stats.savedReviewStats().then(takeAccuracy).catch(() => {});
    // What you comfortably manage, from the reviews you have done lately (used by the "Is it sustainable?" check).
    Stats.savedHistory().then((h) => { if (dead) return; cap = Guard.capacity(Stats.dayCounts(h), Date.now(), Guard.prefs().cap); refresh(); }).catch(() => {});
    Stats.syncReviewStats({}).then(takeAccuracy).catch(() => {});
    backlog(level).then((b) => { if (dead) return; old = b; refresh(); });

    let running = false, want = 0;
    async function fill(upTo) {
      want = Math.max(want, upTo); // a raised target is picked up even while an earlier run is still going
      if (running) return;
      running = true;
      try {
        for (let L = level; L < Math.min(MAX_LEVEL, want) && !dead; L++) {
          if (counts[L] != null) continue;
          const subs = await Local.levelSubjects(L, { background: L !== level });
          if (dead) return;
          const live = subs.filter((s) => !s.data.hidden_at);
          if (L === level) {
            levelInfo = Plan.levelStatus(subs, Local.assignmentFor, Date.now());
            frac = levelInfo.fraction;
            counts[L] = live.filter((s) => { const a = Local.assignmentFor(s.id); return !(a && a.data.started_at); }).length;
          } else counts[L] = live.length;
          refresh();
        }
      } catch (e) { /* the estimates stay in place */ } finally { running = false; }
    }
    fill(Math.max(st.target, saved ? saved.target : 0));
  }

  root.PlanView = { mount, banner, today, backlog };
})(window);
