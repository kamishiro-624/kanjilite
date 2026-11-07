/* KanjiLite – The reviews view and summary.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const S = KL.S;
  const { $, Keep, Session, app, empty, ensureLocal, flushBg, guardNow, loading, makeItem, route, runQuiz, settings, shuffle, tile, toast } = KL;

  // ---------- reviews ----------
  async function reviewsView(my) {
    const stale = () => my !== S.routeSeq;
    loading('Loading reviews…');
    flushBg(); // sent in the background, paced to the rate limit
    await ensureLocal();
    if (stale()) return;
    // Worked out locally. Items you already answered that are still waiting to be sent are left out.
    const all = Local.reviewsDue();
    if (!all.length) { Session.clear(); return empty('No reviews right now', 'Come back when your next reviews are due.'); }
    guardNow().then((r) => { if (r) S.guardSevSeen = r.sev; }).catch(() => {}); // how bad it was before this session, to say so if it gets better

    // Pick up an unfinished session if there is one.
    let chosen, progress;
    const saved = new Map();
    const snap = Session.load();
    if (snap) {
      const byId = new Map(all.map((a) => [a.id, a]));
      const keep = snap.items.filter((x) => byId.has(x.a));
      if (keep.length) {
        chosen = keep.map((x) => byId.get(x.a));
        keep.forEach((x) => saved.set(x.a, x));
        const done = snap.done || 0;
        progress = { done, total: done + keep.length, answered: snap.answered || 0, correct: snap.correct || 0 };
      } else {
        Session.clear();
      }
    }
    if (!chosen) {
      all.sort((a, b) => new Date(a.data.available_at) - new Date(b.data.available_at));
      const cap = settings.sessionSize;
      chosen = cap ? all.slice(0, cap) : all;
    }

    const ids = chosen.map((a) => a.data.subject_id);
    const subs = await api.getSubjects(ids); // saved copy; only anything missing is fetched
    const synonyms = Local.synonyms(ids);
    if (stale()) return;

    const items = chosen.filter((a) => subs.has(a.data.subject_id)).map((a) => {
      const item = makeItem(a, subs.get(a.data.subject_id), synonyms.get(a.data.subject_id));
      const x = saved.get(a.id);
      if (x) {
        const p = (x.p || []).filter((k) => item.pending.includes(k));
        if (p.length) item.pending = p;
        item.incorrect = { meaning: (x.i || [])[0] || 0, reading: (x.i || [])[1] || 0 };
      }
      return item;
    });
    if (!progress) shuffle(items);
    else toast('Picked up your unfinished session.');

    runQuiz({
      items,
      persist: true,
      progress,
      quitMessage: 'Quit for now? Your progress is saved and you can pick up right where you left off.',
      onFinish: (st) => reviewSummary(st, all.length - chosen.length),
    });
  }

  function reviewSummary(st, leftOver) {
    const total = st.doneBase + st.done.length;
    const accuracy = st.answered ? Math.round(st.correct / st.answered * 100) : 100;
    const missed = st.done.filter((i) => i.incorrect.meaning + i.incorrect.reading > 0);
    app.innerHTML = `<div class="wrap">
      <div class="center"><h1>Session complete</h1>
      <p>${total} item${total === 1 ? '' : 's'} reviewed, ${accuracy}% of answers correct.</p>
      <p class="muted" id="sync">Sending results to WaniKani…</p>
      <p class="muted" id="guard-note"></p></div>
      ${missed.length ? `<div class="panel"><h2>Items you missed</h2><div class="tiles">${missed.map((i) => tile(i.subject)).join('')}</div></div>` : ''}
      <div class="row" style="justify-content:center">
        ${leftOver > 0 ? '<a class="btn" href="#/reviews" id="more">Keep going</a>' : ''}
        <a class="btn ghost" href="#/">Back home</a>
      </div></div>`;
    const more = $('#more');
    if (more) more.addEventListener('click', (e) => { e.preventDefault(); route(); });
    // Good news when the pile is back under control, a nudge when it isn't (the workload guard).
    if (Guard.prefs().on) {
      guardNow().then((res) => {
        const m = res && Guard.afterReviews(res, { sev: S.guardSevSeen });
        if (!m) return;
        const el = $('#guard-note'); if (el) { el.textContent = m.text; el.classList.toggle('good', m.good); }
        if (m.good) toast(m.text, 5000);
        S.guardSevSeen = res.sev;
      }).catch(() => {});
    }
    api.flushPending().then((n) => {
      const el = $('#sync');
      if (!el) return;
      const lost = api.refused - (st.refused0 || 0);
      const saved = n ? `${n} result${n > 1 ? 's are' : ' is'} still waiting to send. They will retry automatically.` : 'Results saved to WaniKani.';
      el.textContent = lost > 0 ? `WaniKani did not accept ${lost} result${lost > 1 ? 's' : ''} (already reviewed elsewhere, or no longer due). ${n ? saved : 'The rest were saved.'}` : saved;
      if (lost > 0) el.classList.add('error');
    }).catch((e) => { const el = $('#sync'); if (el) el.textContent = e.message + ' Your results are kept and will retry.'; });
  }

  Object.assign(KL, { reviewsView });
})(window.KL);
