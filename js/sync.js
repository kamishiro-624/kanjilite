/* Optional sync of your plan and settings between devices, using Google sign-in and a small Firestore document
   in your own Firebase project (see SYNC.md). Nothing here runs unless js/config.js is filled in.

   How it works without touching the rest of the app: localStorage writes to the app's own "kl_" keys are noticed
   (setItem/removeItem are wrapped), stamped with the time, and pushed a few seconds later. On start, on returning
   to the tab and after sign-in, the document is read and, key by key, the newer side wins. Device-only things
   (theme, notifications, caches, unsent reviews) never leave the device. The API token is synced only if asked. */
(function (root) {
  'use strict';

  const cfg = root.KL_FIREBASE || {};
  const configured = !!(cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId);
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.5/';
  const TOKEN = 'kl_token';
  const META = 'kl_sync_meta';  // key -> time it was last changed here
  const ON = 'kl_sync_on';      // this device has signed in before, so start syncing at load
  const WITH_TOKEN = 'kl_sync_token';
  const LAST = 'kl_sync_at';
  const DAYS = 'kl_rev_days';   // reviews per day: merged (larger count per day wins) instead of newest-wins
  const PUSH_DELAY = 15000;
  const MAX_VALUE = 60000;      // longest value accepted from the database (the rules cap them much lower)
  const tokenAllowed = cfg.allowTokenSync === true;

  // The only keys that are ever synced. The Firestore rules in SYNC.md list the same ones, so a new setting
  // added to the app has to be added in both places.
  const SYNCED = ['kl_plan', 'kl_plan_dismissed', 'kl_target_level', 'kl_pace_basis', 'kl_pace_custom', 'kl_rev_days',
    'kl_session_size', 'kl_lesson_batch', 'kl_b2b', 'kl_first', 'kl_show_level', 'kl_show_stage', 'kl_srs_toast', 'kl_autoplay', 'kl_wrong_delay'];

  // Never copied anywhere (also left out of backup files): caches, queues, rate-limit bookkeeping and this feature's own state.
  const isVolatile = (k) => /^(kl_(req_log|blocked_until|pending_reviews|pending_starts|session|user|notify_armed|sync_meta|sync_on|sync_token|sync_at)$|kl_kanji_total_)/.test(k);

  const raw = { get: Storage.prototype.getItem, set: Storage.prototype.setItem, del: Storage.prototype.removeItem };
  const read = (k) => { try { return raw.get.call(localStorage, k); } catch (e) { return null; } };
  const write = (k, v) => { try { raw.set.call(localStorage, k, v); } catch (e) { /* storage blocked */ } };
  const drop = (k) => { try { raw.del.call(localStorage, k); } catch (e) { /* ignore */ } };

  const withToken = () => tokenAllowed && read(WITH_TOKEN) === '1';
  const isSynced = (k) => SYNCED.includes(k) || (k === TOKEN && withToken());

  let meta = {};
  try { meta = JSON.parse(read(META)) || {}; } catch (e) { meta = {}; }
  const saveMeta = () => write(META, JSON.stringify(meta));

  const listeners = new Set();
  const state = { user: null, busy: false, error: '', last: Number(read(LAST)) || 0, ready: false };
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  // ---- noticing local changes ----
  let applying = false;
  let dirty = false;
  let pushTimer = 0;
  function touch(k) {
    if (applying || !isSynced(k)) return;
    if (k === TOKEN && read(TOKEN) === null) return; // logging out here must not log you out everywhere
    meta[k] = Date.now();
    saveMeta();
    dirty = true;
    if (state.user) { clearTimeout(pushTimer); pushTimer = setTimeout(() => Sync.syncNow(), PUSH_DELAY); }
  }
  try {
    Storage.prototype.setItem = function (k, v) { raw.set.call(this, k, v); if (this === root.localStorage) touch(String(k)); };
    Storage.prototype.removeItem = function (k) { raw.del.call(this, k); if (this === root.localStorage) touch(String(k)); };
  } catch (e) { /* cannot watch changes; manual "Sync now" still works */ }

  // ---- Firebase, loaded only when needed ----
  let auth = null;
  let db = null;
  let booting = null;
  const load = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load Google’s sign-in. Check your connection.'));
    document.head.appendChild(s);
  });
  function boot() {
    if (!configured) return Promise.reject(new Error('Sync is not set up. See SYNC.md.'));
    if (booting) return booting;
    booting = (async () => {
      await load(SDK + 'firebase-app-compat.js');
      const more = [load(SDK + 'firebase-auth-compat.js'), load(SDK + 'firebase-firestore-compat.js')];
      if (cfg.appCheckSiteKey) more.push(load(SDK + 'firebase-app-check-compat.js'));
      await Promise.all(more);
      root.firebase.initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, appId: cfg.appId });
      // App Check proves to Firebase that requests come from this site, before anything else is called.
      if (cfg.appCheckSiteKey) root.firebase.appCheck().activate(cfg.appCheckSiteKey, true);
      auth = root.firebase.auth();
      db = root.firebase.firestore();
      auth.getRedirectResult().catch(() => {});
      auth.onAuthStateChanged((u) => {
        state.user = u ? { uid: u.uid, email: u.email || '', name: u.displayName || '' } : null;
        state.ready = true;
        emit();
        if (u) Sync.syncNow();
      });
    })().catch((e) => { booting = null; throw e; });
    return booting;
  }

  const friendly = (e) => {
    const c = (e && e.code) || '';
    if (c === 'permission-denied' || c === 'firestore/permission-denied') return 'The database refused the request. Check the Firestore rules in SYNC.md.';
    if (c === 'auth/unauthorized-domain') return 'Add this site’s address under Authentication, Settings, Authorized domains in Firebase.';
    if (c === 'auth/operation-not-allowed') return 'Turn on Google as a sign-in method in Firebase.';
    if (c === 'unavailable' || c === 'firestore/unavailable') return 'Could not reach the sync database. It will retry.';
    return (e && e.message) || 'Sync failed.';
  };

  const parse = (s) => { try { return JSON.parse(s) || {}; } catch (e) { return {}; } };

  function applyLocal(k, v, t) {
    applying = true;
    try { if (v === null) drop(k); else write(k, v); } finally { applying = false; }
    meta[k] = t;
  }

  let syncing = false;
  let again = false;
  async function run() {
    const ref = db.collection('users').doc(state.user.uid);
    const snap = await ref.get();
    const got = (snap.exists && snap.data().data) || {};
    const remote = {};
    Object.keys(got).forEach((k) => {   // ignore anything that is not a plain, reasonably small setting
      const r = got[k];
      if (isSynced(k) && r && typeof r.t === 'number' && (r.v === null || (typeof r.v === 'string' && r.v.length <= MAX_VALUE))) remote[k] = r;
    });
    const push = {};
    let changed = false;
    const keys = new Set([...Object.keys(remote), ...Object.keys(meta)]);
    for (let i = 0; i < localStorage.length; i++) keys.add(localStorage.key(i));

    keys.forEach((k) => {
      if (!isSynced(k)) return;
      const r = remote[k];
      const lt = meta[k] || 0;
      const lv = read(k);

      if (k === DAYS) {
        const a = parse(lv), b = parse(r && r.v);
        const m = Object.assign({}, b);
        Object.keys(a).forEach((d) => { m[d] = Math.max(m[d] || 0, a[d]); });
        const out = JSON.stringify(m);
        if (out === '{}' && !r) return;
        if (out !== lv) { applyLocal(k, out, Date.now()); changed = true; }
        if (!r || out !== r.v) { const t = Date.now(); meta[k] = t; push[k] = { v: out, t }; }
        return;
      }

      if (r && r.t > lt) {                       // the other device changed it more recently
        if (lv !== r.v) { applyLocal(k, r.v, r.t); changed = true; } else meta[k] = r.t;
      } else if (lv !== null && (!r || lt > r.t)) { // changed here (or never shared yet)
        const t = lt || Date.now();
        meta[k] = t;
        push[k] = { v: lv, t };
      } else if (lv === null && r && r.v !== null && lt > r.t) { // removed here
        push[k] = { v: null, t: lt };
      }
    });

    if (Object.keys(push).length) await ref.set({ data: push, updated: root.firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    saveMeta();
    return changed;
  }

  const Sync = {
    configured,
    isVolatile,
    status: () => ({ configured, tokenAllowed, user: state.user, busy: state.busy, error: state.error, last: state.last, ready: state.ready, withToken: withToken() }),
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Start loading Google's sign-in so a later click can open its window straight away. */
    preload() { if (configured) boot().catch(() => {}); },

    /** Start at page load when this device has signed in before. */
    start() { if (configured && read(ON) === '1') boot().catch((e) => { state.error = friendly(e); emit(); }); },

    async signIn(opts) {
      state.error = '';
      if (opts && opts.withToken && tokenAllowed) write(WITH_TOKEN, '1');
      await boot();
      const provider = new root.firebase.auth.GoogleAuthProvider();
      try {
        write(ON, '1');
        await auth.signInWithPopup(provider);
      } catch (e) {
        const c = (e && e.code) || '';
        if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') { drop(ON); return; }
        if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment') { await auth.signInWithRedirect(provider); return; }
        drop(ON);
        state.error = friendly(e); emit();
        throw new Error(state.error);
      }
    },

    async signOut() {
      drop(ON);
      if (auth) await auth.signOut();
      state.user = null; emit();
    },

    /** Turn syncing of the API token on or off. Turning it off also removes it from the database. */
    async setTokenSync(on) {
      if (!tokenAllowed) return;
      write(WITH_TOKEN, on ? '1' : '0');
      if (on) {
        if (read(TOKEN)) { meta[TOKEN] = Date.now(); saveMeta(); }
        return Sync.syncNow();
      }
      if (state.user && db) {
        try { await db.collection('users').doc(state.user.uid).set({ data: { [TOKEN]: { v: null, t: Date.now() } }, updated: root.firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); } catch (e) { state.error = friendly(e); emit(); }
      }
    },

    /** Delete everything stored for this account in the database, and stop syncing on this device. */
    async deleteData() {
      if (!state.user || !db) return;
      await db.collection('users').doc(state.user.uid).delete();
      meta = {}; saveMeta(); dirty = false;
      await Sync.signOut();
    },

    async syncNow() {
      if (!state.user || !db) return false;
      if (syncing) { again = true; return false; }
      syncing = true; state.busy = true; state.error = ''; emit();
      let changed = false;
      try {
        changed = await run();
        dirty = false;
        state.last = Date.now();
        write(LAST, String(state.last));
      } catch (e) {
        state.error = friendly(e);
      } finally {
        syncing = false; state.busy = false; emit();
      }
      if (changed) root.dispatchEvent(new Event('kl-synced'));
      if (again) { again = false; Sync.syncNow(); }
      return changed;
    },
  };

  // Back on the tab: pull what changed elsewhere. Leaving it: send what has not gone yet.
  document.addEventListener('visibilitychange', () => {
    if (!state.user) return;
    if (document.visibilityState === 'visible' && Date.now() - state.last > 60000) Sync.syncNow();
    else if (document.visibilityState === 'hidden' && dirty) Sync.syncNow();
  });

  root.Sync = Sync;
})(window);
