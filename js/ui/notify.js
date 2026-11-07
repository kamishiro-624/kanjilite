/* Browser notifications for new reviews.

   There is no server in KanjiLite, so this works while the app is open in a browser tab (a background tab is fine).
   Review times are already known from the saved copy of your data (each item's available_at), so a timer is set
   for the next one and a cheap local check runs every 30 seconds. Before notifying from a tab you are not looking at,
   it does one quiet sync so reviews you already did elsewhere don't trigger a notification.
   One notification is sent per "wave": it is re-armed once your due count falls below your threshold. */
(function (root) {
  'use strict';

  const ON = 'kl_notify', MIN = 'kl_notify_min', ARMED = 'kl_notify_armed';
  const rd = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const wr = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } };

  const supported = () => typeof Notification !== 'undefined' && window.isSecureContext !== false;
  const permission = () => (supported() ? Notification.permission : 'unsupported');
  const enabled = () => rd(ON) === '1' && permission() === 'granted';
  const minReviews = () => Math.max(1, Math.min(500, Number(rd(MIN)) || 1));
  const BASE_TITLE = document.title;

  let cfg = null, tick = null, timer = null, unsub = null, busy = false;

  function register() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).catch(() => null);
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.go) location.hash = e.data.go; });
  }

  /* A notification that shares a tag with one already on screen *replaces* it. Without `renotify`, that replacement is
     silent: on Windows the old one sits in the notification centre (Action Center) and the new one never pops up as a
     toast until the centre is opened and cleared. So the old notification with the same tag is closed first (the new one
     is then a brand-new notification) and `renotify` is set as a backstop for browsers where closing is not possible. */
  async function show(title, body, extra) {
    const x = extra || {};
    const tag = x.tag || 'kl-reviews';
    const opts = { body, tag, renotify: true, data: { url: x.url || '#/reviews' } };
    try {
      const reg = await register();
      if (reg && reg.showNotification) {
        try {
          if (reg.getNotifications) (await reg.getNotifications({ tag })).forEach((n) => n.close());
        } catch (e) { /* not supported: renotify covers it */ }
        await reg.showNotification(title, opts);
        return true;
      }
    } catch (e) { /* fall through to the plain constructor */ }
    try {
      const n = new Notification(title, opts);
      n.onclick = () => { window.focus(); location.hash = x.url || '#/reviews'; n.close(); };
      return true;
    } catch (e) { return false; }
  }

  const setTitle = (n) => { document.title = enabled() && n > 0 ? `(${n}) ${BASE_TITLE}` : BASE_TITLE; };

  /** The workload guard's serious warnings (reviews piling up, and so on), as a background notification at most once a day.
      Only when you are not looking at the app, and only if notifications are switched on. */
  async function guardCheck(s) {
    if (!cfg || !cfg.guard || s.reviews < 40) return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    try {
      try { await cfg.sync(); } catch (e) { /* use what we have */ }   // don't warn about a pile that was cleared on another device
      const g = await cfg.guard();
      if (g) await show(g.title, g.body, { tag: 'kl-guard', url: '#/' });
    } catch (e) { /* the guard is a nice-to-have */ }
  }

  async function check() {
    if (!cfg || busy) return;
    let s = cfg.summary();
    setTitle(s.reviews);
    if (!enabled()) return;
    guardCheck(s);
    const min = minReviews();
    if (s.reviews < min) { wr(ARMED, '1'); return; }       // nothing (or too little) due: ready for the next wave
    if (rd(ARMED) === '0') return;                           // this wave has been announced already
    if (document.visibilityState === 'visible' && document.hasFocus()) { wr(ARMED, '0'); return; } // you're looking at it
    busy = true;
    try {
      try { await cfg.sync(); } catch (e) { /* use what we have */ }
      s = cfg.summary();
      setTitle(s.reviews);
      if (s.reviews >= min) {
        wr(ARMED, '0');
        const l = s.lessons;
        await show('Reviews ready', `${s.reviews} review${s.reviews === 1 ? ' is' : 's are'} waiting${l ? ` and ${l} lesson${l === 1 ? '' : 's'} are available` : ''}.`);
      }
    } finally { busy = false; }
  }

  function schedule() {
    clearTimeout(timer);
    if (!cfg) return;
    const s = cfg.summary();
    if (!s.nextReviewsAt) return;
    const wait = Date.parse(s.nextReviewsAt) - Date.now() + 1500;
    timer = setTimeout(() => { check(); schedule(); }, Math.min(Math.max(wait, 1000), 2147000000));
  }

  /** cfg: { summary(), sync(), subscribe(fn), guard() (optional: resolves to { title, body } or null) }. Safe to call more than once. */
  function start(c) {
    if (cfg) return;
    cfg = c;
    if (enabled()) register();
    unsub = c.subscribe(() => { schedule(); check(); });
    tick = setInterval(check, 30000);
    document.addEventListener('visibilitychange', onVis);
    schedule(); check();
  }
  const onVis = () => { if (document.visibilityState === 'visible') check(); };
  function stop() {
    clearTimeout(timer); clearInterval(tick);
    if (unsub) unsub();
    document.removeEventListener('visibilitychange', onVis);
    cfg = null; unsub = null;
    document.title = BASE_TITLE;
  }

  /** Must be called from a click: asks the browser for permission if it hasn't been asked. Resolves to the permission. */
  async function enable() {
    if (!supported()) return 'unsupported';
    let p = Notification.permission;
    if (p === 'default') { try { p = await Notification.requestPermission(); } catch (e) { p = 'denied'; } }
    if (p === 'granted') { wr(ON, '1'); wr(ARMED, '1'); register(); if (cfg) { schedule(); check(); } }
    return p;
  }
  function disable() { wr(ON, '0'); if (cfg) check(); }
  function setMin(n) { wr(MIN, Math.max(1, Math.min(500, Math.round(n) || 1))); }
  function test() {
    return permission() === 'granted' ? show('KanjiLite', 'Notifications are working. You’ll see one like this when reviews are ready.') : Promise.resolve(false);
  }
  function statusText() {
    const p = permission();
    if (p === 'unsupported') return 'This browser (or this way of opening the page) doesn’t support notifications. They need https or localhost.';
    if (p === 'denied') return 'Notifications are blocked for this site. Allow them in your browser’s site settings, then switch this on again.';
    if (p === 'default') return 'Your browser will ask for permission when you switch this on.';
    return enabled() ? 'On. Works while KanjiLite is open in a tab, including a background tab. A closed page can’t send notifications.' : 'Permission is granted; switch this on to be notified.';
  }

  root.Notify = { supported, permission, enabled, minReviews, setMin, enable, disable, test, statusText, start, stop };
})(window);
