/* KanjiLite – The settings dialog.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const S = KL.S;
  const { $, Backup, Keep, Session, applyTheme, dlg, esc, go, openModal, renderSyncCard, settings, toast } = KL;

  // ---------- settings ----------
  const setSessionSize = (v) => {
    localStorage.setItem('kl_session_size', String(clampInt(v, 0, 5000)));
    window.dispatchEvent(new Event('kl-settings')); // screens showing a setting keep in step with it
  };
  const setPracticeSize = (v) => {
    localStorage.setItem('kl_practice_size', String(clampInt(v, 5, 200)));
    window.dispatchEvent(new Event('kl-settings'));
  };
  const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v))));

  const bindSel = (id, fn) => UI.bindSelect($('#' + id).closest('[data-select]'), fn);

  /** Settings dialog, in three tabs so each setting has one obvious home:
      Study (everything about how lessons and reviews work), Alerts (notifications and the workload guard) and
      General (appearance, sync, backup, account). Opens on Study; `tab` can be 'study', 'alerts' or 'general'. */
  function openSettings(tab) {
    const which = tab === 'general' || tab === 'alerts' ? tab : 'study';
    const nums = (list) => list.map((n) => ({ value: n, label: String(n) }));
    const delays = [[0, 'Off'], [500, '0.5 seconds'], [1000, '1 second'], [1500, '1.5 seconds'], [2000, '2 seconds'], [3000, '3 seconds']]
      .map(([value, label]) => ({ value, label }));
    const themes = [{ value: 'system', label: 'Match my device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark (matte black)' }];
    const firsts = [{ value: 'random', label: 'Random' }, { value: 'meaning', label: 'Meaning' }, { value: 'reading', label: 'Reading' }];
    const gp = Guard.prefs();
    const tabs3 = [['study', 'Study'], ['alerts', 'Alerts'], ['general', 'General']];

    openModal(`<h2>Settings</h2>
      <div class="tabs" role="tablist" aria-label="Settings sections">
        ${tabs3.map(([k, label]) => `<button type="button" role="tab" id="tab-${k}" data-tab="${k}" aria-controls="panel-${k}" aria-selected="${which === k}" tabindex="${which === k ? 0 : -1}">${label}</button>`).join('')}
      </div>

      <div role="tabpanel" id="panel-study" aria-labelledby="tab-study"${which === 'study' ? '' : ' hidden'}>
        <section class="setcard"><h3>Reviews</h3>
          <div class="field"><label for="s-size">Reviews per session</label>
            ${UI.stepperHTML('s-size', settings.sessionSize, { min: 0, max: 5000, step: 5, label: 'Reviews per session' })}
            <span class="muted">Any number you like. 0 means everything that’s due. Shorter sessions are easier to finish.</span></div>
          ${UI.switchHTML('s-b2b', settings.backToBack, 'Ask an item’s reading and meaning back to back')}
          <div class="field"><label for="s-first">Question asked first</label>${UI.selectHTML('s-first', firsts, settings.firstQ)}</div>
          <div class="field"><label for="s-delay">After a wrong answer, lock “Next” for</label>${UI.selectHTML('s-delay', delays, settings.wrongDelay)}
            <span class="muted">Keeps a stray extra Enter press from skipping the correction. Undo still works.</span></div>
        </section>
        <section class="setcard"><h3>Review cards</h3>
          ${UI.switchHTML('s-level', settings.showLevel, 'Show the item’s level on review cards')}
          ${UI.switchHTML('s-stage', settings.showStage, 'Show the item’s SRS stage on review cards')}
          ${UI.switchHTML('s-srstoast', settings.srsToast, 'Show the new SRS stage after each answer')}
          ${UI.switchHTML('s-autoplay', settings.autoplay, 'Play audio after a correct answer', 'Plays the native-speaker recording of a vocabulary word. Kanji and radicals don’t play automatically. Off by default.')}
        </section>
        <section class="setcard"><h3>Lessons</h3>
          <div class="field"><label for="s-batch">Lessons per batch</label>${UI.selectHTML('s-batch', nums([3, 5, 7, 10]), settings.lessonBatch)}
            <span class="muted">How many new items you study before each quiz.</span></div>
        </section>
        <section class="setcard"><h3>Extra practice</h3>
          <div class="field"><label for="s-psize">Items per practice</label>
            ${UI.stepperHTML('s-psize', settings.practiceSize, { min: 5, max: 200, step: 5, label: 'Items per practice' })}</div>
          ${UI.switchHTML('s-pdaku', settings.practiceDakuten, 'Include dakuten-changed readings', 'In the Different readings practice, also include words that use a kanji’s reading with a voiced sound, like 手紙 (てがみ, from かみ). Words with completely different readings, like 大人 (おとな), and words with readings the kanji lessons didn’t teach, like 選ぶ (えら), are always included.')}
        </section>
      </div>

      <div role="tabpanel" id="panel-alerts" aria-labelledby="tab-alerts"${which === 'alerts' ? '' : ' hidden'}>
        <section class="setcard"><h3>Workload guard</h3>
          <p class="muted">Too many lessons and too few reviews is how backlogs start, and backlogs are why people quit. The guard compares what you’re piling up with what you actually manage, and warns you early on the dashboard. It never stops you; it just says so first.</p>
          ${UI.switchHTML('s-guard', gp.on, 'Warn me before I overcommit', 'Review backlogs, a full Apprentice stage, skipped days, a lesson pace or a plan that is too heavy.')}
          <div class="field"><label for="s-guard-cap">Reviews a day I’m comfortable with</label>
            ${UI.stepperHTML('s-guard-cap', gp.cap, { min: 0, max: 1000, step: 10, label: 'Comfortable reviews a day' })}
            <span class="muted" id="s-guard-capnote">0 works it out from your recent reviews.</span></div>
          ${UI.switchHTML('s-guard-gate', gp.gate, 'Ask before starting lessons when reviews are piled up', 'A prompt, not a block: you can always go ahead. It also asks before more lessons once you’ve done today’s safe amount.')}
        </section>
        <section class="setcard"><h3>Review notifications</h3>
          ${UI.switchHTML('s-notify', Notify.enabled(), 'Notify me when new reviews are available', 'Shown while KanjiLite is open in a browser tab, including a background tab. If the workload guard is on, a serious pile-up is also announced this way, at most once a day.')}
          <div class="field"><label for="s-notify-min">Only when at least this many are due</label>
            ${UI.stepperHTML('s-notify-min', Notify.minReviews(), { min: 1, max: 500, step: 1, label: 'Minimum reviews for a notification' })}</div>
          <p class="muted" id="s-notify-status">${esc(Notify.statusText())}</p>
          <button class="btn ghost small" id="s-notify-test" type="button">Send a test notification</button>
        </section>
      </div>

      <div role="tabpanel" id="panel-general" aria-labelledby="tab-general"${which === 'general' ? '' : ' hidden'}>
        <section class="setcard"><h3>Appearance</h3>
          <div class="field"><label for="s-theme">Theme</label>${UI.selectHTML('s-theme', themes, settings.theme)}</div>
        </section>
        <section class="setcard"><h3>Sync across devices</h3><div id="s-sync"></div></section>
        <section class="setcard"><h3>Back up and restore</h3>
          <p class="muted">Your plan and settings live in this browser. If the browser clears its data they go with it, so keep a copy to restore from.</p>
          ${UI.switchHTML('s-bk-token', false, 'Include my API token in the file', 'The file would then give access to your WaniKani account, within the permissions of your token. Keep it private.')}
          <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
            <button class="btn ghost small" id="s-bk-save" type="button">Save backup file</button>
            <button class="btn ghost small" id="s-bk-load" type="button">Restore from file</button>
            <input type="file" id="s-bk-file" accept="application/json,.json" hidden>
          </div>
          <p class="muted" id="s-bk-status" style="margin-top:8px"></p>
        </section>
        <section class="setcard"><h3>Account</h3>
          <p class="muted">Your token is stored only in this browser and sent only to WaniKani.</p>
          <button class="btn ghost" id="s-logout" type="button">Log out</button>
        </section>
      </div>

      <div class="row end" style="margin-top:18px"><button class="btn" data-close type="button">Done</button></div>`);

    const tabs = [...dlg.querySelectorAll('[role=tab]')];
    const show = (name, focus) => {
      UI.closeSelect();
      tabs.forEach((t) => {
        const on = t.dataset.tab === name;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        $('#panel-' + t.dataset.tab).hidden = !on;
        if (on && focus) t.focus();
      });
    };
    tabs.forEach((t) => {
      t.onclick = () => show(t.dataset.tab);
      t.onkeydown = (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const i = tabs.indexOf(t);
        show(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].dataset.tab, true);
      };
    });
    $('[role=tab][aria-selected=true]').focus();

    bindSel('s-theme', (v) => { localStorage.setItem('kl_theme', v); applyTheme(); });
    bindSel('s-batch', (v) => localStorage.setItem('kl_lesson_batch', String(v)));
    bindSel('s-first', (v) => localStorage.setItem('kl_first', v));
    bindSel('s-delay', (v) => localStorage.setItem('kl_wrong_delay', String(v)));
    UI.bindStepper($('#s-size').closest('[data-stepper]'), setSessionSize);
    UI.bindStepper($('#s-psize').closest('[data-stepper]'), setPracticeSize);
    $('#s-pdaku').onchange = (e) => { localStorage.setItem('kl_practice_dakuten', e.target.checked ? '1' : '0'); window.dispatchEvent(new Event('kl-settings')); };
    $('#s-b2b').onchange = (e) => localStorage.setItem('kl_b2b', e.target.checked ? '1' : '0');
    $('#s-autoplay').onchange = (e) => { localStorage.setItem('kl_autoplay', e.target.checked ? '1' : '0'); if (!e.target.checked && window.Sound) Sound.stop(); };
    $('#s-level').onchange = (e) => localStorage.setItem('kl_show_level', e.target.checked ? '1' : '0');
    $('#s-stage').onchange = (e) => localStorage.setItem('kl_show_stage', e.target.checked ? '1' : '0');
    $('#s-srstoast').onchange = (e) => localStorage.setItem('kl_srs_toast', e.target.checked ? '1' : '0');

    // The workload guard. The dashboard repaints when it hears 'kl-settings'.
    const guardChanged = () => window.dispatchEvent(new Event('kl-settings'));
    $('#s-guard').onchange = (e) => { localStorage.setItem(Guard.KEYS.ON, e.target.checked ? '1' : '0'); guardChanged(); };
    $('#s-guard-gate').onchange = (e) => localStorage.setItem(Guard.KEYS.GATE, e.target.checked ? '1' : '0');
    const capNote = () => {
      Stats.savedHistory().then((h) => {
        const el = $('#s-guard-capnote'); if (!el) return;
        const c = Guard.capacity(Stats.dayCounts(h), Date.now(), Guard.prefs().cap);
        el.textContent = c.auto ? (c.known ? `0 works it out from your recent reviews. Right now that is about ${c.value} a day.` : '0 works it out from your recent reviews. You don’t have enough yet, so it assumes about ' + c.value + ' a day.') : `You set ${c.value} a day. Set 0 to have it worked out from your recent reviews instead.`;
      }).catch(() => {});
    };
    capNote();
    UI.bindStepper($('#s-guard-cap').closest('[data-stepper]'), (v) => { localStorage.setItem(Guard.KEYS.CAP, String(clampInt(v, 0, 1000))); capNote(); guardChanged(); });

    const nStatus = () => { $('#s-notify-status').textContent = Notify.statusText(); };
    $('#s-notify').onchange = async (e) => {
      if (!e.target.checked) { Notify.disable(); nStatus(); return; }
      const p = await Notify.enable();
      if (p !== 'granted') e.target.checked = false;
      nStatus();
    };
    UI.bindStepper($('#s-notify-min').closest('[data-stepper]'), (v) => Notify.setMin(v));
    $('#s-notify-test').onclick = async () => {
      if (Notify.permission() !== 'granted') { const p = await Notify.enable(); $('#s-notify').checked = Notify.enabled(); nStatus(); if (p !== 'granted') return; }
      if (!(await Notify.test())) toast('The browser wouldn’t show the notification.');
    };
    renderSyncCard();
    $('#s-bk-save').onclick = () => Backup.save($('#s-bk-token').checked);
    $('#s-bk-load').onclick = () => $('#s-bk-file').click();
    $('#s-bk-file').onchange = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) Backup.restore(f); };
    Keep.status().then((t) => { const el = $('#s-bk-status'); if (el) el.textContent = t; });
    $('#s-logout').onclick = async () => {
      const left = api.pending().length + api.pendingStarts().length;
      const ok = await UI.confirm({
        title: 'Log out?',
        message: left ? `You have ${left} finished review(s) or lesson(s) that haven’t been sent to WaniKani yet. Logging out will discard them.` : 'This removes your token and the saved copy of your data from this browser.',
        ok: 'Log out', danger: true,
      });
      if (!ok) return;
      Notify.stop(); await Local.wipe(); api.reset(); Stats.reset(); Session.clear(); S.userCache = null; dlg.close(); go('#/');
    };
  }
  $('#open-settings').addEventListener('click', () => openSettings());

  // After the dialog closes in the middle of a quiz, put the cursor back where it was.
  dlg.addEventListener('close', () => {
    const f = $('.quiz #q-input:not([readonly])') || $('.quiz #q-go');
    if (f) f.focus();
  });

  Object.assign(KL, { openSettings, setPracticeSize, setSessionSize });
})(window.KL);
