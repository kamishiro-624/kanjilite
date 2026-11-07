/* KanjiLite – The quiz engine shared by reviews and the lesson quiz.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const S = KL.S;
  const { $, Keep, STAGES, Session, TYPE_LABEL, app, esc, flushBg, glyph, glyphClass, go, nextStage, rand, renderInfo, settings, toast, typeClass } = KL;

  // ---------- quiz engine (reviews and the lesson quiz) ----------
  /** Your synonyms for an item right now, so ones added in the details during a session count immediately. */
  const liveSynonyms = (item) => Local.synonyms([item.subject.id]).get(item.subject.id) || item.synonyms || [];

  function makeItem(assignment, subject, synonyms) {
    const meaningOnly = subject.object === 'radical' || subject.object === 'kana_vocabulary';
    return { assignment, subject, synonyms: synonyms || [], pending: meaningOnly ? ['meaning'] : ['meaning', 'reading'], incorrect: { meaning: 0, reading: 0 } };
  }

  function runQuiz(opts) {
    const practice = !!opts.practice;
    const prog = opts.progress || {};
    const st = {
      queue: opts.items.slice(), pool: [], done: [], doneBase: prog.done || 0,
      total: prog.total || opts.items.length, answered: prog.answered || 0, correct: prog.correct || 0,
      cur: null, phase: 'ask', lastCorrect: false, undo: null, uncommitted: null, lockUntil: 0,
      refused0: api.refused,
    };
    const BATCH = 10;
    const doneN = () => st.doneBase + st.done.length;

    // A finished item is sent to WaniKani as soon as you move on to the next card
    // (until then "Undo answer" can still take it back).
    function commit() {
      const item = st.uncommitted;
      if (!item) return;
      st.uncommitted = null;
      // Remember what you got wrong, for the "Recent mistakes" practice set (kept on this device).
      if (item.incorrect.meaning + item.incorrect.reading > 0 && S.userCache) Practice.noteMistakes(S.userCache.u.id, [item.subject.id]);
      if (practice) return;
      api.queueReview({
        assignment_id: item.assignment.id,
        incorrect_meaning_answers: item.incorrect.meaning,
        incorrect_reading_answers: item.incorrect.reading,
        created_at: new Date(api.now() - 1000).toISOString(),
      });
      // Counted for the streak, the "reviews today" figure and the review graphs.
      const from = item.assignment.data.srs_stage || 0;
      Stats.noteReview(undefined, { im: item.incorrect.meaning, ir: item.incorrect.reading, from, to: nextStage(from, item.incorrect.meaning + item.incorrect.reading) });
      flushBg(); // stays queued if it fails, retried later
    }

    // Progress on unfinished items (including half-answered ones) is saved after every answer.
    function save() {
      if (!opts.persist) return;
      const left = st.pool.concat(st.queue);
      if (!left.length) { Session.clear(); return; }
      Session.save({
        v: 1, savedAt: Date.now(), total: st.total, done: doneN(), answered: st.answered, correct: st.correct,
        items: left.map((i) => ({ a: i.assignment.id, p: i.pending, i: [i.incorrect.meaning, i.incorrect.reading] })),
      });
    }

    function pickKind(item) {
      const first = settings.firstQ;
      if (first !== 'random' && item.pending.includes(first)) return first;
      return rand(item.pending);
    }

    function next() {
      hideSrsToast();
      commit();
      while (st.pool.length < BATCH && st.queue.length) st.pool.push(st.queue.shift());
      if (!st.pool.length) {
        st.phase = 'done';
        document.body.classList.remove('in-quiz'); // the summary screen gets its header back
        if (opts.persist) Session.clear();
        opts.onFinish(st);
        return;
      }
      save();
      const prev = st.cur;
      let item;
      if (settings.backToBack && prev && st.lastCorrect && prev.item.pending.length && st.pool.includes(prev.item)) {
        item = prev.item; // keep going with the same item
      } else {
        let candidates = st.pool;
        if (candidates.length > 1 && prev) candidates = candidates.filter((i) => i !== prev.item);
        item = rand(candidates);
      }
      st.cur = { item, kind: pickKind(item) };
      st.undo = null;
      st.phase = 'ask';
      draw();
    }

    function updateTop() {
      const pct = st.total ? Math.round(doneN() / st.total * 100) : 0;
      const bar = $('#q-bar'); if (bar) bar.style.width = Math.min(100, pct) + '%';
      const stats = $('#q-stats');
      if (stats) stats.textContent = `${Math.max(0, st.total - doneN())} left` + (st.answered ? `, ${Math.round(st.correct / st.answered * 100)}% correct` : '');
    }

    function draw() {
      st.lockUntil = 0;
      const { item, kind } = st.cur;
      const s = item.subject;
      const label = `${TYPE_LABEL[s.object]} ${kind === 'reading' ? 'reading' : (s.object === 'radical' ? 'name' : 'meaning')}`;
      const stage = item.assignment.data.srs_stage || 0;
      const showLevel = settings.showLevel;
      const showStage = settings.showStage && !practice && stage > 0;
      const cardHTML = `<div class="qcard t-${typeClass(s.object)}">
            ${showLevel || showStage ? `<div class="qmeta">
              ${showLevel ? `<span class="qpill qlevel">Level ${s.data.level}</span>` : ''}
              ${showStage ? `<span class="qpill qstage" title="Current SRS stage">${esc(STAGES[stage])}</span>` : ''}
            </div>` : ''}
            <div class="qglyph ${glyphClass(s)}">${glyph(s)}</div>
            <div class="qlabel">${esc(label)}</div>
          </div>`;
      const isReading = kind === 'reading';
      let input = $('#q-input');
      const rebuild = !(input && $('#q-form') && $('#q-box') && app.firstElementChild && app.firstElementChild.classList.contains('quiz'));
      if (rebuild) {
        app.innerHTML = `<div class="quiz">
        <div class="qtop">
          <button class="link" id="q-quit" type="button">Quit</button>
          <span class="qstats" id="q-stats"></span>
          ${practice ? '<span></span>' : '<button class="link" id="q-wrap" type="button">Wrap up</button>'}
        </div>
        <div class="progress"><i id="q-bar"></i></div>
        <div class="qbox" id="q-box">
          ${cardHTML}
          <form id="q-form" class="answer" autocomplete="off">
            <input id="q-input" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done">
            <button id="q-go" type="submit">Check</button>
          </form>
        </div>
        <div class="qmsg" id="q-msg"></div>
        <div id="q-feedback"></div>
      </div>`;
        input = $('#q-input');
      } else {
        // Same input element, same focus: the on-screen keyboard stays open between questions.
        const box = $('#q-box');
        box.className = 'qbox';
        box.querySelector('.qcard').outerHTML = cardHTML;
        const form = $('#q-form');
        form.className = 'answer';
        const go = $('#q-go');
        go.textContent = 'Check';
        go.className = '';
        go.removeAttribute('aria-disabled');
        go.style.removeProperty('--lock');
        $('#q-feedback').innerHTML = '';
        input.classList.remove('shake');
        input.removeAttribute('aria-readonly');
        input.value = '';
        $('#q-msg').textContent = '';
        $('#q-msg').classList.remove('warn');
      }
      input.lang = isReading ? 'ja' : 'en';
      input.placeholder = isReading ? 'こたえ' : 'Your answer';
      input.setAttribute('aria-label', label);
      updateTop();
      // preventScroll: the page must not jump (and push the card off screen) when the keyboard comes up.
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
      if (window.scrollY) window.scrollTo(0, 0);

      if (rebuild) {
        input.addEventListener('input', (e) => {
          if (st.phase !== 'ask') {
            // After an answer the box shows the verdict and must not change, but it stays focused so the keyboard stays up.
            if (input.value !== st.shown) input.value = st.shown || '';
            return;
          }
          if (e.isComposing || !st.cur || st.cur.kind !== 'reading') return;
          const v = Kana.toKana(input.value);
          if (v !== input.value) input.value = v;
        });
        input.addEventListener('beforeinput', (e) => { if (st.phase !== 'ask' && e.cancelable) e.preventDefault(); });
        // Tapping Check/Next must not pull focus off the answer box, or the keyboard closes.
        $('#q-go').addEventListener('mousedown', (e) => { if (coarsePointer()) e.preventDefault(); });
        $('#q-form').addEventListener('submit', (e) => {
          e.preventDefault();
          if (st.phase === 'ask') submit();
          else if (st.phase === 'feedback') {
            if (Date.now() < st.lockUntil) nudge(); // still locked after a wrong answer
            else next();
          }
        });
      }
      $('#q-quit').onclick = async () => {
        const ok = await UI.confirm({ title: 'Quit this session?', message: opts.quitMessage || 'Your progress will not be kept.', ok: 'Quit', cancel: 'Keep going', danger: true });
        if (ok) go('#/');
      };
      const wrap = $('#q-wrap');
      if (wrap) wrap.onclick = () => {
        st.queue = [];
        st.total = doneN() + st.pool.length;
        wrap.disabled = true;
        updateTop();
        save();
        toast('Wrapping up: finish the items already in progress.');
      };
    }

    function msg(text, warn) {
      const m = $('#q-msg');
      m.textContent = text || '';
      m.classList.toggle('warn', !!warn);
    }

    function submit() {
      const input = $('#q-input');
      const { item, kind } = st.cur;
      const res = kind === 'meaning' ? Check.meaning(item.subject, liveSynonyms(item), input.value) : Check.reading(item.subject, input.value);
      if (res.invalid) {
        msg(res.invalid, true);
        input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
        return;
      }
      // A reading is shown the way it was judged: romaji and a trailing n become kana, stray symbols are gone.
      if (kind === 'reading' && res.kana) input.value = res.kana;
      st.undo = {
        item, kind, value: input.value, pending: item.pending.slice(), incorrect: Object.assign({}, item.incorrect),
        answered: st.answered, correct: st.correct, lastCorrect: st.lastCorrect,
      };
      st.answered++;
      if (res.correct) { st.correct++; item.pending = item.pending.filter((k) => k !== kind); } else { item.incorrect[kind]++; }
      st.lastCorrect = !!res.correct;
      st.phase = 'feedback';
      if (res.correct && !item.pending.length) {
        st.pool = st.pool.filter((i) => i !== item);
        st.done.push(item);
        st.uncommitted = item;
      }
      // The SRS stage only changes once both questions are answered, but after a wrong answer we already
      // show where the item is heading (it can only go lower from here).
      let srs = null;
      if (!practice && settings.srsToast && (!res.correct || !item.pending.length)) {
        const from = item.assignment.data.srs_stage || 0;
        srs = { from, to: nextStage(from, item.incorrect.meaning + item.incorrect.reading) };
      }
      showFeedback(res);
      showSrsToast(srs);
      // Reviews only (not the lesson quiz), and only when switched on in Settings.
      if (res.correct && !practice && settings.autoplay && window.Sound) {
        Sound.autoplay(item.subject, () => st.cur && st.cur.item === item && st.phase === 'feedback');
      }
      updateTop();
      save();
    }

    function undo() {
      const u = st.undo;
      if (!u || st.phase !== 'feedback') return;
      const item = u.item;
      item.pending = u.pending;
      item.incorrect = u.incorrect;
      st.answered = u.answered;
      st.correct = u.correct;
      st.lastCorrect = u.lastCorrect;
      if (st.uncommitted === item) {
        st.uncommitted = null;
        st.done = st.done.filter((i) => i !== item);
        if (!st.pool.includes(item)) st.pool.unshift(item);
      }
      st.undo = null;
      st.cur = { item, kind: u.kind };
      st.phase = 'ask';
      hideSrsToast();
      if (window.Sound) Sound.stop();
      draw();
      const input = $('#q-input');
      input.value = u.value;
      input.select();
      save();
    }

    const ICON_OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const ICON_BAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
    // Small pill at the top of the screen: where the item just moved to.
    let srsTimer = 0;
    function srsToastEl() {
      let el = $('#srs-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'srs-toast';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
      }
      return el;
    }
    function hideSrsToast() {
      clearTimeout(srsTimer);
      const el = $('#srs-toast');
      if (el) el.className = '';
    }
    function showSrsToast(srs) {
      if (!srs) return;
      const el = srsToastEl();
      const dir = srs.to > srs.from ? 'up' : srs.to < srs.from ? 'down' : 'same';
      const arrow = dir === 'up' ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10V2M2.5 5.5L6 2l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : dir === 'down' ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v8M2.5 6.5L6 10l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';
      el.innerHTML = `${arrow}<span>${esc(STAGES[srs.to])}</span>`;
      el.className = '';
      void el.offsetWidth; // restart the animation when answers come quickly
      el.className = 'show ' + dir;
      clearTimeout(srsTimer);
      srsTimer = setTimeout(hideSrsToast, 1900);
    }

    const coarsePointer = () => !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    // A brief wash of green or red over the whole screen.
    // Driven by a transition plus a timer rather than a keyframe animation and "animationend": some phones (battery
    // saver, "remove animations", older WebViews) never run or finish keyframes, and then the wash never showed.
    // With reduced motion the colour still appears, just without the fade.
    function flash(ok) {
      const f = document.createElement('div');
      f.className = 'flash ' + (ok ? 'ok' : 'bad') + (reduceMotion() ? ' still' : '');
      f.setAttribute('aria-hidden', 'true');
      document.body.appendChild(f);
      void f.offsetWidth;
      f.classList.add('on');
      setTimeout(() => f.classList.remove('on'), reduceMotion() ? 280 : 160);
      setTimeout(() => f.remove(), reduceMotion() ? 340 : 700);
    }

    function nudge() {
      const b = $('#q-go');
      if (!b) return;
      b.classList.remove('nudge'); void b.offsetWidth; b.classList.add('nudge');
    }

    function showFeedback(res) {
      const { item, kind } = st.cur;
      const d = item.subject.data;
      const input = $('#q-input');
      const btn = $('#q-go');
      st.shown = input.value;
      input.setAttribute('aria-readonly', 'true');
      $('#q-form').classList.add(res.correct ? 'ok' : 'bad');
      btn.textContent = 'Next';
      msg('');

      // Right and wrong look and move differently: ring, badge, label bar, banner, flash, shake or pop.
      const box = $('#q-box');
      const card = $('.qcard');
      box.classList.add(res.correct ? 'res-ok' : 'res-bad');
      card.insertAdjacentHTML('beforeend', `<span class="qbadge ${res.correct ? 'ok' : 'bad'}" aria-hidden="true">${res.correct ? ICON_OK : ICON_BAD}</span>`);
      flash(res.correct);

      // After a wrong answer "Next" stays locked for a moment so a quick extra Enter can't skip the correction.
      const delay = res.correct ? 0 : settings.wrongDelay;
      st.lockUntil = delay > 0 ? Date.now() + delay : 0;
      if (delay > 0) {
        btn.classList.add('locking');
        btn.setAttribute('aria-disabled', 'true');
        btn.style.setProperty('--lock', delay + 'ms');
        setTimeout(() => { btn.classList.remove('locking'); btn.removeAttribute('aria-disabled'); }, delay);
      }

      let accepted;
      if (kind === 'meaning') {
        accepted = d.meanings.filter((m) => m.accepted_answer).map((m) => m.meaning).concat(liveSynonyms(item));
      } else {
        accepted = (d.readings || []).filter((r) => r.accepted_answer).map((r) => r.reading);
      }
      $('#q-feedback').innerHTML = `
        <div class="undo-row"><button type="button" class="btn ghost small" id="q-undo">Undo answer</button><span class="muted undo-hint">or Ctrl/Cmd+Z</span></div>
        <div class="verdict ${res.correct ? 'ok' : 'bad'}" role="status"><span class="v-icon">${res.correct ? ICON_OK : ICON_BAD}</span><span>${res.correct ? (res.fuzzy ? 'Correct, counted as a close match' : 'Correct') : 'Incorrect'}</span></div>
        <p class="answers"><span class="muted">Accepted:</span> ${esc(accepted.join(', '))}</p>
        <details class="info"${res.correct ? '' : ' open'}><summary>Details</summary><div class="info-body">${renderInfo(item.subject, null, { nextReview: false })}</div></details>`;
      $('#q-undo').onclick = undo;
      // Touch screens: keep the cursor in the answer box so the keyboard stays open and Enter goes to the next card.
      // Keyboard users still land on the button, as before.
      if (coarsePointer()) { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } } else btn.focus();
    }

    // Keyboard undo, and make sure a finished card is saved when you leave the page.
    const onKey = (e) => {
      if (UI.anyDialogOpen() || st.phase !== 'feedback') return;
      // Holding Enter must not repeat through the feedback card.
      if (e.key === 'Enter' && e.repeat) { e.preventDefault(); return; }
      // Typing in a synonym or note box in the details must not trigger the answer undo.
      if (e.target && e.target.closest && e.target.closest('.mat-box')) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    };
    const onHide = () => { if (document.visibilityState === 'hidden') commit(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', commit);
    document.body.classList.add('in-quiz');
    S.cleanup = () => {
      document.body.classList.remove('in-quiz');
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', commit);
      hideSrsToast();
      commit();
    };

    next();
  }

  Object.assign(KL, { makeItem, runQuiz });
})(window.KL);
