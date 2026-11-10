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
    get practiceDakuten() { return localStorage.getItem('kl_practice_dakuten') === '1'; }, // "Different readings" also holds dakuten-changed words
    get practiceOrder() { return localStorage.getItem('kl_practice_order') || 'default'; }, // how practice items are picked and sorted
    get theme() { return localStorage.getItem('kl_theme') || 'system'; }, // system | light | dark | glass
    get fx() { return localStorage.getItem('kl_fx') || 'auto'; }, // visual effects: auto | full | lite (this device only)
    get flash() { return localStorage.getItem('kl_flash') !== '0'; }, // the colour wash after an answer
    get flashLevel() { return Math.max(10, Math.min(200, getNum('kl_flash_level', 100))); }, // percent of the normal strength
  };
  function applyTheme() {
    const t = settings.theme;
    if (t === 'light' || t === 'dark' || t === 'glass') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'glass' || t === 'dark' ? '#000000' : '#3d4fc4';
  }
  applyTheme();

  // ---------- visual effects: full or lite ----------
  // Lite drops the expensive things (blur behind glass, glows, shaking and popping animations, long fades) so older and
  // slower phones stay smooth. "Auto" picks it when the device says it is short on power: data saver on, 4 or fewer
  // CPU cores, 2 GB of memory or less, or an old WebView without backdrop blur.
  function autoLite() {
    try {
      const c = navigator.connection;
      if (c && c.saveData) return true;
      if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) return true;
      if (navigator.deviceMemory && navigator.deviceMemory <= 2) return true;
      if (window.CSS && CSS.supports && !(CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'))) return true;
    } catch (e) { /* ignore */ }
    return false;
  }
  const fxLite = () => settings.fx === 'lite' || (settings.fx === 'auto' && autoLite());
  function applyFx() { document.documentElement.dataset.fx = fxLite() ? 'lite' : 'full'; }
  applyFx();

  // ---------- the colour wash after an answer ----------
  // Drawn frame by frame from the clock rather than with a CSS transition and timers. On phones the page is busy
  // redrawing the card at the very moment the answer lands, so a timer-driven fade would start late, run out before
  // anything was painted, or show only part of the screen (the layer is drawn tile by tile, top first). Here the clock
  // starts at the first frame after that work is done, a single slow frame can't skip a stage, and the layer is made
  // ahead of time (flashPrime) so it is already drawn when the answer comes.
  let flashEl = null;
  let flashRaf = 0;
  function flashLayer() {
    if (flashEl && flashEl.isConnected) return flashEl;
    flashEl = document.createElement('div');
    flashEl.className = 'flash';
    flashEl.setAttribute('aria-hidden', 'true');
    // In the browser's top layer (where supported) it always covers the whole screen, whatever the page or a popup is doing.
    try { if (flashEl.showPopover) flashEl.setAttribute('popover', 'manual'); } catch (e) { /* ignore */ }
    document.body.appendChild(flashEl);
    try { if (flashEl.showPopover) flashEl.showPopover(); } catch (e) { /* ignore */ }
    return flashEl;
  }
  function flashPrime() { if (settings.flash) flashLayer(); }
  function flashDrop() {
    cancelAnimationFrame(flashRaf);
    if (flashEl) flashEl.remove();
    flashEl = null;
  }
  /** ok: green wash for a right answer, red for a wrong one. level overrides the saved intensity (for the preview). */
  function screenFlash(ok, level) {
    if (!settings.flash && level == null) return;
    const strength = (level == null ? settings.flashLevel : level) / 100;
    const peak = Math.min(.85, (ok ? .16 : .3) * strength);
    if (peak <= 0) return;
    const f = flashLayer();
    f.className = 'flash ' + (ok ? 'ok' : 'bad');
    // A popup opened after the layer was made sits above it: bring it back to the front.
    try { if (f.hidePopover && document.querySelector('dialog[open]')) { f.hidePopover(); f.showPopover(); } } catch (e) { /* ignore */ }
    const still = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const lite = document.documentElement.dataset.fx === 'lite';
    const up = still || lite ? 0 : 90, hold = still ? 240 : 70, down = still ? 0 : lite ? 220 : 420;
    cancelAnimationFrame(flashRaf);
    let last = 0, t = 0;
    const step = (now) => {
      if (last) t += Math.min(now - last, 48); // a slow frame can't jump past a stage
      last = now;
      let o;
      if (t < up) o = peak * (t / up);
      else if (t < up + hold) o = peak;
      else if (t < up + hold + down) { const k = (t - up - hold) / down; o = peak * (1 - k * (2 - k)); } // ease out
      else { f.style.opacity = '0'; return; }
      f.style.opacity = String(o);
      flashRaf = requestAnimationFrame(step);
    };
    flashRaf = requestAnimationFrame(step);
  }

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

  Object.assign(KL, { $, LESSON_CAP, Session, app, applyFx, applyTheme, dlg, flashDrop, flashPrime, fxLite, screenFlash, empty, esc, flushBg, go, loading, rand, settings, shuffle, toast });
})(window.KL = window.KL || {});
