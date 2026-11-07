/* KanjiLite – Sync across devices: sign-in forms, the nav button, refresh when idle.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const { $, Keep, dlg, esc, openModal, settings, toast } = KL;
  // From files loaded later; looked up when called.
  const openSettings = (...a) => KL.openSettings(...a);
  const route = (...a) => KL.route(...a);

  // ---------- sync across devices (optional, see SYNC.md) ----------
  // The sign-in form: Google, or an email and password (create an account, sign in, reset a forgotten password).
  // It is used inside Settings and in a small dialog opened from the header, the home banner and the login screen.
  let syAuthN = 0;
  function syncAuthHTML() {
    const n = ++syAuthN;
    return `<div class="sy-auth">
      <button class="btn ghost" type="button" data-sy="google">Continue with Google</button>
      <p class="muted sy-or">or use your email address</p>
      <form data-sy="form" novalidate>
        <div class="field"><label for="sy-email-${n}">Email</label>
          <input id="sy-email-${n}" data-sy="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" inputmode="email"></div>
        <div class="field"><label for="sy-pass-${n}">Password</label>
          <input id="sy-pass-${n}" data-sy="pass" type="password" autocomplete="current-password">
          <span class="muted" data-sy="hint" hidden>At least 8 characters.</span></div>
        <div class="error" data-sy="err" role="alert"></div>
        <p class="sy-note" data-sy="note" role="status"></p>
        <div class="sy-actions">
          <button class="btn small" type="submit" data-sy="submit">Sign in</button>
          <button class="link inline" type="button" data-sy="mode">Create an account</button>
          <button class="link inline" type="button" data-sy="forgot">Forgot password?</button>
        </div>
      </form>
    </div>`;
  }

  /** Wire up a form made by syncAuthHTML(). opts: { withToken, onDone } (onDone runs once someone is signed in). */
  function bindSyncAuth(root, opts) {
    opts = opts || {};
    const q = (name) => root.querySelector(`[data-sy="${name}"]`);
    const form = q('form'), err = q('err'), note = q('note'), emailEl = q('email'), passEl = q('pass');
    const signOpts = opts.withToken ? { withToken: true } : undefined;
    let creating = false;

    const busy = (on) => root.querySelectorAll('button, input').forEach((el) => { el.disabled = on; });
    const paint = () => {
      q('submit').textContent = creating ? 'Create account' : 'Sign in';
      q('mode').textContent = creating ? 'I already have an account' : 'Create an account';
      q('forgot').hidden = creating;
      q('hint').hidden = !creating;
      passEl.autocomplete = creating ? 'new-password' : 'current-password';
      err.textContent = ''; note.textContent = '';
    };
    const finish = async () => { if (Sync.status().user && opts.onDone) await opts.onDone(); };
    paint();

    q('google').onclick = async () => {
      err.textContent = ''; note.textContent = '';
      busy(true);
      try { wantsRefresh(); await Sync.signIn(signOpts); await finish(); } catch (e) { err.textContent = (e && e.message) || 'Could not sign in.'; }
      busy(false);
    };
    q('mode').onclick = () => { creating = !creating; paint(); };
    q('forgot').onclick = async () => {
      err.textContent = ''; note.textContent = '';
      const email = emailEl.value.trim();
      if (!email) { err.textContent = 'Enter your email address above first.'; emailEl.focus(); return; }
      busy(true);
      try {
        await Sync.resetPassword(email);
        note.textContent = `If an account exists for ${email}, an email with a link to choose a new password is on its way.`;
      } catch (e) { err.textContent = (e && e.message) || 'Could not send the email.'; }
      busy(false);
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      err.textContent = ''; note.textContent = '';
      const email = emailEl.value.trim(), pw = passEl.value;
      if (!email) { err.textContent = 'Enter your email address.'; emailEl.focus(); return; }
      if (!pw) { err.textContent = 'Enter your password.'; passEl.focus(); return; }
      busy(true);
      try {
        wantsRefresh();
        if (creating) await Sync.signUpEmail(email, pw, signOpts); else await Sync.signInEmail(email, pw, signOpts);
        await finish();
      } catch (e2) { err.textContent = (e2 && e2.message) || 'Could not sign in.'; }
      busy(false);
    };
  }

  /** A small dialog with the sign-in form, for the places outside Settings. */
  function openSyncDialog(opts) {
    opts = opts || {};
    Sync.preload();
    openModal(`<h2>${esc(opts.title || 'Sign in to sync')}</h2>
      <p class="muted">${esc(opts.intro || 'Keep your plan and settings the same on every device you use. Sign in with Google, or with an email address and password. They are stored in your own Firebase project, readable only by your account.')}</p>
      ${syncAuthHTML()}`);
    bindSyncAuth($('#modal-body .sy-auth'), {
      withToken: opts.withToken,
      onDone: async () => { dlg.close(); if (opts.onDone) await opts.onDone(); },
    });
    const first = $('#modal-body [data-sy=email]'); if (first) first.focus();
  }

  function renderSyncCard() {
    const el = $('#s-sync');
    if (!el) return;
    const st = Sync.status();
    if (!st.configured) {
      el.innerHTML = '<p class="muted">Not set up. Add your Firebase details to <b>js/config.js</b> (the steps are in SYNC.md) to keep your plan and settings in step across your devices.</p>';
      return;
    }
    Sync.preload();
    const when = st.last ? 'Last synced ' + new Date(st.last).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.' : '';
    if (!st.user) {
      el.innerHTML = `<p class="muted">Sign in to keep your plan and settings the same on every device you use. They are stored in your own Firebase project, readable only by your account.</p>
        ${st.error ? `<p class="error">${esc(st.error)}</p>` : ''}
        ${syncAuthHTML()}`;
      bindSyncAuth(el.querySelector('.sy-auth'), { onDone: async () => renderSyncCard() });
    } else {
      const needsVerify = st.user.password && !st.user.verified;
      el.innerHTML = `<p class="muted">Signed in as ${esc(st.user.email || st.user.name || 'your account')}. Your plan and settings sync automatically. ${st.busy ? 'Syncing…' : esc(when)}</p>
        ${needsVerify ? '<p class="muted">Your email address is not verified yet. Open the link in the email we sent you. <button class="link inline" id="s-sy-verify" type="button">Send it again</button></p>' : ''}
        ${st.error ? `<p class="error">${esc(st.error)}</p>` : ''}
        ${st.tokenAllowed ? UI.switchHTML('s-sy-token', st.withToken, 'Also sync my API token', 'Lets a new device restore everything by signing in to your account alone. The token is stored in the sync database, so use this only if you are comfortable with that. Turning it off removes it from there.') : ''}
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
          <button class="btn ghost small" id="s-sy-now" type="button"${st.busy ? ' disabled' : ''}>Check now</button>
          <button class="btn ghost small" id="s-sy-out" type="button">Sign out of sync</button>
          <button class="btn ghost small" id="s-sy-del" type="button">Delete my synced data</button>
        </div>`;
      const tk = $('#s-sy-token'); if (tk) tk.onchange = (e) => Sync.setTokenSync(e.target.checked);
      const vf = $('#s-sy-verify');
      if (vf) vf.onclick = async () => {
        vf.disabled = true;
        try { await Sync.sendVerification(); toast('Verification email sent.'); } catch (e) { toast((e && e.message) || 'Could not send it.'); }
        vf.disabled = false;
      };
      $('#s-sy-del').onclick = async () => {
        const ok = await UI.confirm({ title: 'Delete your synced data?', message: 'This removes your plan and settings from the sync database and turns sync off on this device. Nothing on this device is deleted.', ok: 'Delete', danger: true });
        if (!ok) return;
        try { await Sync.deleteData(); toast('Your synced data was deleted.'); } catch (e) { toast((e && e.message) || 'Could not delete it.'); }
        renderSyncCard();
      };
      $('#s-sy-now').onclick = () => Sync.syncNow();
      $('#s-sy-out').onclick = async () => { await Sync.signOut(); renderSyncCard(); };
    }
    renderSyncCard.uid = st.user ? st.user.uid : '';
    // Keep the card current while the dialog is open (a sync finishing, an error, signing in).
    if (!renderSyncCard.off) {
      renderSyncCard.off = Sync.on(() => {
        if (!$('#s-sync')) { renderSyncCard.off(); renderSyncCard.off = null; return; }
        // Do not rebuild the sign-in form under someone who is typing in it (unless they have just signed in or out).
        const ae = document.activeElement;
        const nowUid = (Sync.status().user || {}).uid || '';
        if (ae && ae.tagName === 'INPUT' && ae.closest && ae.closest('#s-sync') && nowUid === renderSyncCard.uid) return;
        if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#s-sync') && document.activeElement.id === 's-sy-token') return;
        renderSyncCard();
      });
    }
  }

  // New data arrived from another device. Show it by refreshing the page, but never in the middle of a quiz,
  // while a dialog is open or while you are typing: then it waits until you are done.
  let pendingRefresh = null; // 'reload' | 'route'
  let forceUntil = 0;
  const inQuiz = () => /^#\/?(reviews|lessons)/.test(location.hash);
  const typing = () => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
  const wantsRefresh = () => { forceUntil = Date.now() + 30000; }; // the person just signed in: show what arrived right away

  function flushRefresh() {
    if (!pendingRefresh || !api.token || inQuiz()) return;
    const forced = Date.now() < forceUntil;
    if (!forced && (dlg.open || typing())) return;
    const kind = pendingRefresh;
    pendingRefresh = null;
    let recent = false;
    try { recent = Date.now() - Number(sessionStorage.getItem('kl_reload_at') || 0) < 15000; } catch (e) { /* ignore */ }
    if (kind === 'reload' && !recent) {
      try { sessionStorage.setItem('kl_reload_at', String(Date.now())); } catch (e) { /* ignore */ }
      location.reload();
    } else if (!dlg.open) route();
  }
  window.addEventListener('kl-synced', (e) => {
    const keys = (e.detail && e.detail.keys) || [];
    // Only the review counts changed: redraw quietly. Anything else: reload so every screen shows it.
    pendingRefresh = keys.some((k) => k !== 'kl_rev_days') ? 'reload' : (pendingRefresh || 'route');
    flushRefresh();
  });
  window.addEventListener('hashchange', () => setTimeout(flushRefresh, 0));
  dlg.addEventListener('close', () => setTimeout(flushRefresh, 0));
  document.addEventListener('focusout', () => setTimeout(flushRefresh, 400));

  // Sign in from the header or the home banner: a small dialog with the Google and email options.
  function signInToSync() { openSyncDialog(); }

  function paintSyncButton() {
    const b = $('#sync-btn');
    if (!b) return;
    if (!Sync.configured) { b.hidden = true; return; }
    b.hidden = false;
    const st = Sync.status();
    let state = 'off', long = 'Sign in to sync', short = 'Sync', tip = 'Sign in to keep your plan and settings the same on all your devices.';
    if (st.user) {
      if (st.error) { state = 'error'; long = 'Sync error'; tip = st.error; }
      else if (st.busy) { state = 'busy'; long = 'Syncing…'; tip = 'Syncing your plan and settings.'; }
      else { state = 'ok'; long = 'Synced'; tip = 'Your plan and settings are kept in sync automatically. Open Settings to manage.'; }
    } else if (st.remembered) { state = 'busy'; long = 'Sync'; tip = 'Connecting to sync…'; }
    b.dataset.state = state;
    b.querySelector('.sync-long').textContent = long;
    b.querySelector('.sync-short').textContent = short;
    b.title = tip;
    b.setAttribute('aria-label', long === 'Sync' ? 'Sync' : long);
  }
  $('#sync-btn').addEventListener('click', () => {
    const st = Sync.status();
    if (!st.user && !st.remembered) { signInToSync(); return; }
    openSettings('general');
    setTimeout(() => { const el = $('#s-sync'); if (el) el.scrollIntoView({ block: 'center' }); }, 50);
  });
  if (Sync.configured) Sync.on(paintSyncButton);
  paintSyncButton();

  Object.assign(KL, { openSyncDialog, renderSyncCard, signInToSync });
})(window.KL);
