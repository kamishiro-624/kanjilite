/* KanjiLite – The home (dashboard) view.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const S = KL.S;
  const { $, Keep, Session, app, ensureLocal, esc, flushBg, guardContext, loading, openSettings, setPracticeSize, setSessionSize, settings, signInToSync, syncFailed, tile, toast, userKnown } = KL;

  // ---------- home ----------
  // Everything on this screen is worked out from the saved copy of your data, so it opens instantly, costs no
  // requests, and keeps itself current (counts change as reviews become due, uploads finish, syncs arrive).
  async function homeView(my) {
    const stale = () => my !== S.routeSeq;
    if (!Local.hasData() || !userKnown()) loading('Setting up your account…');
    const user = await ensureLocal();
    if (stale()) return;

    const hourLabel = (iso) => {
      const d = new Date(iso);
      const sameDay = d.toDateString() === new Date().toDateString();
      return d.toLocaleString([], sameDay ? { hour: 'numeric' } : { weekday: 'short', hour: 'numeric' });
    };
    let shown = '';
    let progressHtml = '';
    let numbersHtml = '';
    let critHtml = '';
    let planHtml = '';
    let todayHtml = '';
    let guardHtml = '';
    let guardRes = null;
    let announced = false;
    let practiceHtml = '';
    let spreadHtml = '';
    Stats.bind(user.id);
    // What the widgets below the progress bars are built from. Filled from the saved copies first, refreshed in the background.
    const X = { lp: null, hist: null, rs: null, rsSummary: null, subs: new Map(), progress: null, levelIds: null, loaded: false };

    function draw(force) {
      if (stale()) return;
      const u = S.userCache ? S.userCache.u : user;
      const sd = Local.summary();
      const pendR = api.pending().length;
      const pendS = api.pendingStarts().length;
      const snap = Session.load();
      const sig = JSON.stringify([u.level, sd, pendR, pendS, snap && snap.items.length]);
      if (!force && sig === shown) return;
      // Don't rebuild the screen under someone who is typing in the session-length box.
      if (!force && app.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
      shown = sig;

      const maxUp = Math.max(1, ...sd.upcoming.map((x) => x.count));
      const syncSt = Sync.status();
      const syncHint = Sync.configured && !syncSt.user && !syncSt.remembered && localStorage.getItem('kl_sync_hint') !== '0';
      const waiting = [pendR ? `<b>${pendR} finished review${pendR > 1 ? 's' : ''}</b>` : '', pendS ? `<b>${pendS} started lesson${pendS > 1 ? 's' : ''}</b>` : ''].filter(Boolean).join(' and ');
      app.innerHTML = `<div class="wrap">
        <div class="greet"><h1>Hello, ${esc(u.username)}</h1><p class="muted">Level ${u.level}</p></div>
        ${waiting ? `<div class="banner">${waiting} still waiting to be sent to WaniKani. <button class="link" id="retry-sync" type="button">Send now</button></div>` : ''}
        ${syncHint ? '<div class="banner info">Keep your plan and settings the same on all your devices. <button class="link" id="sync-hint-in" type="button">Sign in</button> <button class="link" id="sync-hint-x" type="button">Not now</button></div>' : ''}
        ${snap ? `<div class="banner info">You have an unfinished review session with <b>${snap.items.length} item${snap.items.length > 1 ? 's' : ''}</b> left. Open Reviews to pick it up. <button class="link" id="discard-session" type="button">Discard it</button></div>` : ''}
        <div id="dash-guard">${guardHtml}</div>
        <div id="dash-plan">${planHtml}</div>
        <div id="dash-today">${todayHtml}</div>
        <div class="todo">
          <a class="reviews${sd.reviews ? '' : ' off'}" href="#/reviews"><span class="what">Reviews</span><span class="count">${sd.reviews}</span></a>
          <a class="lessons${sd.lessons ? '' : ' off'}" href="#/lessons"><span class="what">Lessons</span><span class="count">${sd.lessons}</span></a>
        </div>
        <div class="panel session-panel">
          <label for="h-size"><b>Reviews per session</b></label>
          ${UI.stepperHTML('h-size', settings.sessionSize, { min: 0, max: 5000, step: 5, label: 'Reviews per session' })}
          <span class="muted">0 means everything that’s due. <button class="link inline" id="h-more" type="button">More study options</button></span>
        </div>
        <div id="dash-practice">${practiceHtml}</div>
        <div id="dash-spread">${spreadHtml}</div>
        <div id="lvl-progress">${progressHtml}</div>
        <div id="dash-numbers">${numbersHtml}</div>
        <div id="dash-critical">${critHtml}</div>
        <div class="panel">
          <h2>Coming up</h2>
          ${sd.upcoming.length ? `<div class="forecast">${sd.upcoming.map((x) => `<div><span>${esc(hourLabel(x.available_at))}</span><span><span class="bar" style="display:block;width:${Math.max(4, Math.round(x.count / maxUp * 100))}%"></span></span><span class="n">${x.count}</span></div>`).join('')}</div>`
            : `<p class="muted">${sd.nextReviewsAt ? 'Next reviews: ' + esc(new Date(sd.nextReviewsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })) : 'Nothing scheduled in the next 24 hours.'}</p>`}
        </div>
      </div>`;

      bindPlan();
      bindGuard();
      paintPractice();
      paintSpread();
      UI.bindStepper($('#h-size').closest('[data-stepper]'), (v) => { setSessionSize(v); toast('Session length saved.'); });
      $('#h-more').onclick = () => openSettings('study');
      const discard = $('#discard-session');
      if (discard) discard.onclick = async () => {
        const ok = await UI.confirm({ title: 'Discard this session?', message: 'Items you already finished are safe on WaniKani.', ok: 'Discard', danger: true });
        if (ok) { Session.clear(); draw(true); }
      };
      const sin = $('#sync-hint-in');
      if (sin) sin.onclick = () => {
        const off = Sync.on(() => { if (Sync.status().user) { off(); draw(true); } });
        signInToSync();
      };
      const sx = $('#sync-hint-x');
      if (sx) sx.onclick = () => { localStorage.setItem('kl_sync_hint', '0'); draw(true); };
      const retry = $('#retry-sync');
      if (retry) retry.onclick = async () => {
        retry.disabled = true;
        try { await api.flushPending(); toast('Sent to WaniKani.'); } catch (e) { toast(e.message); }
        draw();
      };
    }

    // Extra practice: counts come from the saved copy (no requests); "critical" and "current level" fill in once their data has loaded.
    function paintPractice() {
      if (stale()) return;
      const ctx = {
        all: Local.allAssignments(), assignmentFor: Local.assignmentFor, mistakes: Practice.readLog(user.id),
        rows: X.rs ? X.rs.rows : null, levelIds: X.levelIds, size: settings.practiceSize,
      };
      const kinds = Practice.KINDS.map((k) => ({ key: k.key, title: k.title, desc: k.desc, count: Practice.count(k.key, ctx) }));
      practiceHtml = Dash.practice(kinds, UI.stepperHTML('p-size', settings.practiceSize, { min: 5, max: 200, step: 5, label: 'Items per practice' }));
      const box = $('#dash-practice');
      if (!box) return;
      // Don't rebuild the panel under someone who is typing in its size box.
      if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
      box.innerHTML = practiceHtml;
      UI.bindStepper($('#p-size').closest('[data-stepper]'), (v) => { setPracticeSize(v); toast('Practice length saved.'); });
    }

    // Item spread: every started item, by SRS stage and kind, from the saved copy.
    function paintSpread() {
      if (stale()) return;
      const counts = {};
      Local.allAssignments().forEach((a) => {
        const d = a.data;
        if (d.hidden || !(d.srs_stage >= 1)) return;
        const g = Dash.spreadGroup(d.srs_stage);
        const c = counts[g] || (counts[g] = [0, 0, 0]);
        c[d.subject_type === 'radical' ? 0 : d.subject_type === 'kanji' ? 1 : 2]++;
      });
      spreadHtml = Dash.spread(counts);
      const box = $('#dash-spread');
      if (box) box.innerHTML = spreadHtml;
    }

    // The workload check. Rebuilt from guardRes whenever the data or a setting changes.
    function paintGuard() {
      if (stale()) return;
      guardHtml = X.loaded && guardRes ? GuardView.panel(guardRes, settings.sessionSize) : '';
      const box = $('#dash-guard');
      if (box) { box.innerHTML = guardHtml; bindGuard(); }
    }
    function bindGuard() {
      const box = $('#dash-guard');
      if (!box) return;
      box.querySelectorAll('[data-guard-snooze]').forEach((b) => {
        b.onclick = () => {
          const w = guardRes && guardRes.warnings.find((x) => x.id === b.dataset.guardSnooze);
          if (w) Guard.snooze(w);
          paintGuard();
        };
      });
      box.querySelectorAll('[data-guard-session]').forEach((b) => {
        b.onclick = () => { const n = Number(b.dataset.guardSession); setSessionSize(n); toast(`Sessions are now ${n} reviews, so each one is easier to finish.`); paintGuard(); };
      });
    }

    function bindPlan() {
      const d = $('#plan-dismiss');
      if (d) d.onclick = () => { Plan.dismiss(); planHtml = ''; const b = $('#dash-plan'); if (b) b.innerHTML = ''; };
    }

    // Level progress, split into radicals, kanji and vocabulary and coloured by SRS stage.
    // 90% of the level's kanji at Guru or above unlocks the next level.
    async function drawProgress() {
      try {
        const lvl = (S.userCache ? S.userCache.u : user).level;
        const subs = await Local.levelSubjects(lvl, { background: true });
        if (stale()) return;
        progressHtml = Dash.levelProgress(lvl, subs, Local.assignmentFor);
        X.levelIds = new Set(subs.filter((x) => !x.data.hidden_at).map((x) => x.id));
        const kanji = subs.filter((x) => x.object === 'kanji' && !x.data.hidden_at);
        const need = Math.ceil(kanji.length * 0.9);
        const done = kanji.filter((x) => { const a = Local.assignmentFor(x.id); return a && a.data.srs_stage >= 5; }).length;
        X.progress = need ? { fraction: Math.min(1, done / need) } : null;
        S.lastFrac = X.progress ? X.progress.fraction : null;
        const box = $('#lvl-progress');
        if (box) box.innerHTML = progressHtml;
      } catch (e) { /* progress is a nice-to-have */ }
      paintExtras();
    }

    // "Your numbers" and "Critical condition".
    function paintExtras() {
      if (stale()) return;
      const u = S.userCache ? S.userCache.u : user;
      const lvl = u.level;
      const now = Date.now();
      const counts = Stats.dayCounts(X.hist);
      const streak = Stats.streakInfo(counts, now);
      const ls = Stats.levelStats(X.lp || [], lvl, now);
      let basis = localStorage.getItem('kl_pace_basis') || 'all';
      const pace = Stats.paceFor(ls.done, basis, Number(localStorage.getItem('kl_pace_custom')) || 12);
      const est = X.lp ? Stats.estimate({ level: lvl, target: lvl + 1, pace, elapsedDays: ls.elapsedDays, progress: X.progress ? X.progress.fraction : null, now }) : null;
      const all = Local.allAssignments().filter((a) => !a.data.hidden && a.data.srs_stage >= 1);
      if (X.rs && !X.rsSummary) X.rsSummary = Stats.summarizeReviewStats(X.rs.rows);
      const ans = X.rsSummary ? X.rsSummary.answers : null;
      numbersHtml = Dash.numbers({
        user: u, level: lvl, streak, haveHistory: !!(X.hist && X.hist.n), ls, pace, est,
        reviewsToday: streak.today, bestDay: X.hist && X.hist.n ? Math.max.apply(null, [0].concat(Object.keys(counts).map((k) => counts[k]))) : 0,
        burned: all.filter((a) => a.data.srs_stage === 9).length, started: all.length,
        accuracy: ans && ans.c + ans.i ? Math.round(ans.c / (ans.c + ans.i) * 1000) / 10 : null, answers: ans ? ans.c + ans.i : 0,
      });
      const nb = $('#dash-numbers'); if (nb) nb.innerHTML = numbersHtml;

      // Workload check: what you are piling up against what you manage. Needs your review history, so it waits for that.
      guardRes = Guard.evaluate(guardContext(user.id, lvl, X.hist, X.rs, X.progress ? X.progress.fraction : null));
      const guardOn = Guard.prefs().on;
      paintGuard();
      // A toast the first time per day the picture gets worse (and only once the saved copy is fresh, so a stale one can't cry wolf).
      if (!announced && X.loaded && guardOn && (Local._lastRefresh > 0 || navigator.onLine === false)) {
        announced = true;
        const msg = Guard.toAnnounce(guardRes);
        if (msg) toast(msg, 7000);
      }

      // Off-track warning against the saved plan (needs the level progress, so it waits for that).
      const plan = Plan.load(user.id);
      planHtml = plan && X.progress && !Plan.dismissedToday() ? PlanView.banner(plan, Plan.evaluate(plan, lvl + X.progress.fraction, now), guardOn ? guardRes : null) : '';
      const pb = $('#dash-plan'); if (pb) { pb.innerHTML = planHtml; bindPlan(); }

      // Today's lessons and reviews against the plan (all from the saved copy, no requests).
      if (plan && X.progress && Plan.evaluate(plan, lvl + X.progress.fraction, now).state !== 'done') {
        const dk = Stats.dayKey(new Date(now));
        const doneToday = counts[dk] || 0;
        const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
        // The day's review total is worked out once and kept (see Plan.reviewsToday), so the bar only moves as you review.
        // It waits for the saved copy to be brought up to date first, so stale data isn't locked in.
        const rt = Plan.reviewsToday(doneToday, Local.reviewsDueBy(midnight.getTime()), Local._lastRefresh > 0 || navigator.onLine === false);
        const acc = X.rs ? Stats.accuracyOf(X.rs.rows) : null;
        const planAcc = plan.acc != null ? plan.acc : Plan.DEFAULT_ACC;
        todayHtml = PlanView.today(plan, {
          lessonsDone: Local.allAssignments().filter((a) => a.data.started_at && Stats.dayKey(new Date(a.data.started_at)) === dk).length,
          lessonsQueue: Local.lessonsAvailable().length,
          reviewsDone: doneToday,
          reviewsDue: Local.reviewsDue().length,
          reviewsTotal: rt.total,
          acc,
          guard: Object.assign({ on: guardOn }, guardRes.allowance, { note: guardRes.recovery ? guardRes.recovery.planText : '' }),
          // Reviews a day from new lessons at your accuracy now (the saved figure is from when you made the plan).
          rpd: plan.lpd ? Plan.reviewsPerDay(plan.lpd, Math.max(1, (plan.end - plan.start) / 86400000), acc != null ? acc : planAcc) : 0,
        });
      } else todayHtml = '';
      const tb = $('#dash-today'); if (tb) tb.innerHTML = todayHtml;

      if (!X.rs) { critHtml = Dash.critical(null, 0, 75, tile); }
      else {
        const live = (id) => { const a = Local.assignmentFor(id); return !!a && !a.data.hidden && a.data.srs_stage >= 1 && a.data.srs_stage < 9; };
        const cr = Stats.criticalItems(X.rs.rows, live, { below: 75, limit: 8 });
        const missing = cr.items.map((x) => x.id).filter((id) => !X.subs.has(id));
        if (missing.length) {
          api.getSubjects(missing, { background: true }).then((m) => { m.forEach((v, k) => X.subs.set(k, v)); paintExtras(); }).catch(() => {});
        }
        const items = cr.items.filter((x) => X.subs.has(x.id)).map((x) => Object.assign({ subject: X.subs.get(x.id) }, x));
        critHtml = Dash.critical(missing.length && !items.length ? null : items, cr.count, 75, tile);
      }
      const cb = $('#dash-critical'); if (cb) cb.innerHTML = critHtml;
      paintPractice();
      paintSpread();
    }

    async function loadExtras() {
      try {
        const [lp, hist, rs] = await Promise.all([Stats.savedProgressions(), Stats.savedHistory(), Stats.savedReviewStats()]);
        if (stale()) return;
        X.lp = lp ? lp.rows : null; X.hist = hist; X.rs = rs; X.rsSummary = null; X.loaded = true;
        paintExtras();
        if (!lp || Date.now() - lp.at > 5 * 60000) {
          Stats.fetchProgressions({ background: true }).then((rows) => { X.lp = rows; paintExtras(); }).catch(() => {});
        }
        if (!rs || Date.now() - rs.at > 30 * 60000) {
          Stats.syncReviewStats({}).then((r) => { X.rs = r; X.rsSummary = null; paintExtras(); }).catch(() => {});
        }
      } catch (e) { X.loaded = true; /* these widgets are a nice-to-have */ }
    }

    const redraw = () => { draw(); drawProgress(); };
    draw(true);
    drawProgress();
    loadExtras();
    // Once the quiet sync from opening the app has finished, redraw so today's review total is worked out from fresh data.
    Promise.resolve(Local._refreshing).catch(() => {}).then(() => { if (!stale()) paintExtras(); });

    // Keep it current: when data changes, once a half-minute (reviews fall due with time), and a quiet sync every few minutes.
    S.onUserChange = () => { draw(true); drawProgress(); };
    // The review length can also be changed in Settings, so keep the box on this screen in step with it.
    const onSettings = () => {
      const st = $('#h-size'); if (st) UI.setStepper(st.closest('[data-stepper]'), settings.sessionSize);
      const ps = $('#p-size'); if (ps) UI.setStepper(ps.closest('[data-stepper]'), settings.practiceSize);
      if (X.loaded) paintExtras(); // the workload guard's settings (or the session length) may have changed
    };
    window.addEventListener('kl-settings', onSettings);
    const unsub = Local.subscribe(redraw);
    const tick = setInterval(() => { if (document.visibilityState === 'visible') draw(); }, 30000);
    const sync = setInterval(() => { if (document.visibilityState === 'visible') Local.refresh({ minAge: 4 * 60000 }).catch(syncFailed); }, 60000);
    S.cleanup = () => { clearInterval(tick); clearInterval(sync); unsub(); S.onUserChange = null; window.removeEventListener('kl-settings', onSettings); };

    // Send anything waiting, in the background.
    if (api.pending().length || api.pendingStarts().length) flushBg().then(() => draw());
  }

  Object.assign(KL, { homeView });
})(window.KL);
