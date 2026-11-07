/* KanjiLite – The lessons view.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const S = KL.S;
  const { $, LESSON_CAP, TYPE_ORDER, app, dlg, empty, ensureLocal, flushBg, glyph, guardNow, hero, lessonsGate, loading, makeItem, renderInfo, runQuiz, settings, shuffle, toast, typeClass } = KL;

  // ---------- lessons ----------
  async function lessonsView(my) {
    const stale = () => my !== S.routeSeq;
    loading('Loading lessons…');
    await ensureLocal();
    if (stale()) return;
    const all = Local.lessonsAvailable();
    if (!all.length) return empty('No lessons right now', 'New lessons unlock as you pass items in your reviews.');
    // If reviews are piled up, say so before adding to the pile (a prompt; "Start lessons anyway" always works).
    if (!(await lessonsGate(false))) return;
    if (stale()) return;

    const subs = await api.getSubjects(all.slice(0, LESSON_CAP).map((a) => a.data.subject_id));
    if (stale()) return;
    const items = all.filter((a) => subs.has(a.data.subject_id)).map((a) => makeItem(a, subs.get(a.data.subject_id)));
    items.sort((a, b) => a.subject.data.level - b.subject.data.level
      || TYPE_ORDER[a.subject.object] - TYPE_ORDER[b.subject.object]
      || (a.subject.data.lesson_position || 0) - (b.subject.data.lesson_position || 0));
    lessonBatch(items, my);
  }

  async function lessonBatch(remaining, my) {
    const stale = () => my !== S.routeSeq;
    const size = settings.lessonBatch;
    const batch = remaining.slice(0, size);
    const rest = remaining.slice(size);

    loading();
    const relIds = batch.flatMap((i) => i.subject.data.component_subject_ids || []);
    const related = await api.getSubjects(relIds).catch(() => new Map());
    if (stale()) return;

    let idx = 0;
    const seen = new Set([0]);
    const onKey = (e) => {
      if (dlg.open || /input|select|textarea/i.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    if (S.cleanup) S.cleanup();
    document.addEventListener('keydown', onKey);
    S.cleanup = () => document.removeEventListener('keydown', onKey);

    function step(d) {
      const n = idx + d;
      if (n < 0 || n >= batch.length) return;
      idx = n; seen.add(n); draw();
    }

    function draw() {
      const cur = batch[idx].subject;
      const last = idx === batch.length - 1;
      const allSeen = seen.size === batch.length;
      app.innerHTML = `<div class="wrap">
        <div class="row between" style="margin-bottom:10px"><span class="muted">Lesson ${idx + 1} of ${batch.length}${rest.length ? `, ${rest.length} more after this batch` : ''}</span><a class="link" href="#/">Leave</a></div>
        <div class="ltabs">${batch.map((b, i) => `<button type="button" class="ltab t-${typeClass(b.subject.object)}${i === idx ? ' on' : seen.has(i) ? ' seen' : ''}" data-tab="${i}" aria-label="Item ${i + 1}">${glyph(b.subject)}</button>`).join('')}</div>
        ${hero(cur)}
        <div class="info-body">${renderInfo(cur, related, { usedIn: false })}</div>
        <div class="lnav">
          <button class="btn ghost" id="l-prev" type="button"${idx === 0 ? ' disabled' : ''}>Back</button>
          ${last ? `<button class="btn" id="l-quiz" type="button"${allSeen ? '' : ' disabled'}>${allSeen ? 'Start quiz' : 'View every item first'}</button>`
            : '<button class="btn" id="l-next" type="button">Next</button>'}
        </div></div>`;
      window.scrollTo(0, 0);
      document.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { idx = Number(b.dataset.tab); seen.add(idx); draw(); }; });
      $('#l-prev').onclick = () => step(-1);
      const nx = $('#l-next'); if (nx) nx.onclick = () => step(1);
      const q = $('#l-quiz'); if (q) q.onclick = startQuiz;
    }

    function startQuiz() {
      S.cleanup(); S.cleanup = null;
      const quizItems = shuffle(batch.map((i) => makeItem(i.assignment, i.subject)));
      runQuiz({
        items: quizItems,
        practice: true,
        quitMessage: 'Quit the quiz? These lessons will not be started.',
        onFinish: () => {
          // The items show as started straight away; telling WaniKani happens in the background.
          batch.forEach((i) => Local.markStarted(i.assignment.id, api.queueStart(i.assignment.id).started_at));
          if (stale()) { flushBg(); return; }
          app.innerHTML = `<div class="wrap center"><h1>Batch complete</h1>
            <p>${batch.length} item${batch.length === 1 ? '' : 's'} started. The first review comes in about four hours.</p>
            <p class="muted" id="sync">Saving to WaniKani…</p>
            <p class="muted" id="guard-note"></p>
            <div class="row" style="justify-content:center">
              ${rest.length ? `<button class="btn" id="nb" type="button">Next batch (${rest.length} left)</button>` : ''}
              <a class="btn ghost" href="#/">Back home</a></div></div>`;
          const nb = $('#nb'); if (nb) nb.onclick = async () => { if (await lessonsGate(true)) lessonBatch(rest, my); };
          // What these lessons add, and where that leaves today (the workload guard).
          if (Guard.prefs().on) {
            guardNow().then((res) => {
              if (!res) return;
              const el = $('#guard-note'); if (el) el.textContent = Guard.afterLessons(res, batch.length);
              const a = res.allowance;
              if (a.paused || (a.allowed && a.done >= a.allowed)) toast('That’s today’s safe amount of lessons. The rest can wait until tomorrow.', 6000);
            }).catch(() => {});
          }
          api.flushPending().then((n) => {
            const el = $('#sync');
            if (el) el.textContent = n ? 'Still waiting to send. It will retry automatically.' : 'Saved to WaniKani.';
          }).catch((e) => { const el = $('#sync'); if (el) { el.textContent = e.message + ' Your lessons are kept and will retry.'; el.classList.add('error'); } });
        },
      });
    }

    draw();
  }

  Object.assign(KL, { lessonBatch, lessonsView });
})(window.KL);
