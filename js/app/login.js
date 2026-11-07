/* KanjiLite – The login view.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const { $, Keep, app, esc, getUser, go, openSyncDialog, settings } = KL;

  // ---------- login ----------
  function loginView(msg) {
    $('#nav').hidden = true;
    app.innerHTML = `<div class="wrap login">
      <h1>鰐 KanjiLite</h1>
      <p>A small, unofficial client for your WaniKani account: lessons, reviews and a level browser.</p>
      <form id="login-form">
        <label for="tok">WaniKani API token</label>
        <input id="tok" type="password" autocomplete="off" spellcheck="false" required>
        <button class="btn" style="margin-top:14px" type="submit">Connect</button>
        <div class="error" id="login-err">${esc(msg || '')}</div>
      </form>
      ${Sync.configured && Sync.status().tokenAllowed ? '<div class="login-alt"><p class="fine">Already use KanjiLite on another device?</p><button class="btn ghost" id="login-google" type="button">Sign in to restore</button></div>' : ''}
      <p class="fine">Create a token under <a href="https://www.wanikani.com/settings/personal_access_tokens" target="_blank" rel="noopener">Settings, Personal Access Tokens</a> on WaniKani. Tick <b>assignments:start</b> and <b>reviews:create</b> so your lessons and reviews are saved. The token stays in this browser and is only sent to api.wanikani.com.</p>
    </div>`;
    const lg = $('#login-google');
    if (lg) {
      Sync.preload();
      lg.onclick = () => openSyncDialog({
        title: 'Restore from your account',
        intro: 'Sign in with the Google or email account you use for sync. Your API token comes back with it if you chose to sync it.',
        withToken: true,
        onDone: async () => {
          await Sync.syncNow();
          if (api.token) { go('#/'); return; }
          const le = $('#login-err');
          if (le) le.textContent = 'Signed in, but no API token was saved with your account. Paste it above; turn on “Also sync my API token” in Settings to save it.';
        },
      });
    }
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      api.token = $('#tok').value.trim();
      try {
        await getUser(true);
        Keep.request();
        go('#/');
      } catch (err) {
        api.token = '';
        $('#login-err').textContent = err.message;
        btn.disabled = false;
      }
    });
  }

  Object.assign(KL, { loginView });
})(window.KL);
