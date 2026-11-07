/* KanjiLite – Helpers, settings, the saved review session, toasts and navigation.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  // State that more than one file reads and writes.
  const S = KL.S = {
    lastFrac: null, // how far through the current level (0..1), once the dashboard has worked it out
    guardSevSeen: 0, // how bad things were when a review session started, to say "back under control" afterwards
    routeSeq: 0,
    cleanup: null,
    userCache: null,
    userRefresh: null,
    onUserChange: null, // set by the dashboard so a level-up shows without a reload
  };
  // From files loaded later; looked up when called.
  const lessonBatch = (...a) => KL.lessonBatch(...a);
  const route = (...a) => KL.route(...a);

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const app = $('#app');
  const dlg = $('#modal');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rand = (a) => a[Math.floor(Math.random() * a.length)];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const getNum = (k, d) => { const v = localStorage.getItem(k); return v === null ? d : Number(v); };
  const settings = {
    get lessonBatch() { return getNum('kl_lesson_batch', 5); },
    get sessionSize() { return getNum('kl_session_size', 100); }, // 0 = everything
    get backToBack() { return localStorage.getItem('kl_b2b') === '1'; },
    get firstQ() { return localStorage.getItem('kl_first') || 'random'; }, // random | meaning | reading
    get showLevel() { return localStorage.getItem('kl_show_level') !== '0'; },
    get showStage() { return localStorage.getItem('kl_show_stage') !== '0'; },
    get srsToast() { return localStorage.getItem('kl_srs_toast') !== '0'; },
    get autoplay() { return localStorage.getItem('kl_autoplay') === '1'; }, // off unless switched on
    get wrongDelay() { return getNum('kl_wrong_delay', 1000); }, // ms "Next" stays locked after a wrong answer
    get practiceSize() { return Math.max(5, Math.min(200, getNum('kl_practice_size', 20))); }, // items in one extra-practice session
    get theme() { return localStorage.getItem('kl_theme') || 'system'; }, // system | light | dark
  };
  function applyTheme() {
    const t = settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  applyTheme();

  // Unfinished review session, saved after every answer so you can leave and come back.
  const Session = {
    key: 'kl_session',
    load() {
      try { const x = JSON.parse(localStorage.getItem(this.key)); return x && x.v === 1 && Array.isArray(x.items) && x.items.length ? x : null; } catch (e) { return null; }
    },
    save(x) { try { localStorage.setItem(this.key, JSON.stringify(x)); } catch (e) { /* storage full or blocked */ } },
    clear() { localStorage.removeItem(this.key); },
  };
  const LESSON_CAP = 100;

  let toastTimer;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 3800);
  }

  // The API layer paces itself to WaniKani's rate limit; tell the person when a screen has to wait.
  let waitToastAt = 0;
  api.onWait = (ms) => {
    if (Date.now() - waitToastAt < 8000) return;
    waitToastAt = Date.now();
    toast(`Pausing about ${Math.ceil(ms / 1000)}s to stay within WaniKani’s rate limit…`);
  };

  // Uploads started in the background used to fail silently. Say so when WaniKani refuses one outright,
  // and when the token is missing the permission needed to save anything at all.
  api.onRefused = (item, err) => toast('WaniKani did not accept one result (' + err.message + '). It was skipped.');
  let permToastAt = 0;
  function flushBg() {
    return api.flushPending().catch((e) => {
      if (e && e.status === 403 && Date.now() - permToastAt > 30000) { permToastAt = Date.now(); toast(e.message); }
      return api.pending().length + api.pendingStarts().length;
    });
  }

  const loading = (msg) => { app.innerHTML = `<div class="wrap center"><div class="spinner"></div><p class="muted">${esc(msg || 'Loading…')}</p></div>`; };
  const empty = (title, text) => { app.innerHTML = `<div class="wrap center"><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p><a class="btn" href="#/">Back home</a></div>`; };

  function go(hash) {
    if (location.hash === hash) route(); else location.hash = hash;
  }

  Object.assign(KL, { $, LESSON_CAP, Session, app, applyTheme, dlg, empty, esc, flushBg, go, loading, rand, settings, shuffle, toast });
})(window.KL = window.KL || {});
