/* Minimal WaniKani API v2 client: throttled requests, pagination, persistent subject cache, review queue. */
(function (root) {
  'use strict';

  const BASE = 'https://api.wanikani.com/v2';
  const REVISION = '20170710';
  const TOKEN_KEY = 'kl_token';
  const PENDING_KEY = 'kl_pending_reviews';

  // WaniKani allows 60 requests per minute per token. We stay under that on our own, counting requests
  // in localStorage so the budget is shared across tabs and page reloads. Background work (sending
  // finished reviews, nice-to-have lookups) gets a smaller share so it can never starve a screen
  // the user is waiting for.
  const WINDOW = 60000;
  const CAP_INTERACTIVE = 54;
  const CAP_BACKGROUND = 45;
  const LOG_KEY = 'kl_req_log';
  const MAX_429_RETRIES = 4;

  const SUBJECT_TTL = 14 * 24 * 3600 * 1000; // subjects almost never change
  const SYNONYM_TTL = 10 * 60 * 1000;
  const DB_NAME = 'kanjilite';
  const STORE = 'subjects';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chunk = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status || 0;
    }
  }

  // ---- rate limiter ----
  let blockedUntil = 0; // set when WaniKani answers 429; everything waits

  function readLog(now) {
    try {
      const raw = JSON.parse(localStorage.getItem(LOG_KEY));
      if (Array.isArray(raw)) return raw.filter((t) => typeof t === 'number' && now - t < WINDOW).sort((a, b) => a - b);
    } catch (e) { /* ignore */ }
    return [];
  }
  function writeLog(log) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (e) { /* ignore */ }
  }

  /** Resolves when it is safe to send one request. */
  async function acquire(background) {
    let told = false;
    for (;;) {
      const now = Date.now();
      let wait;
      if (now < blockedUntil) {
        wait = blockedUntil - now;
      } else {
        const log = readLog(now);
        const cap = background ? CAP_BACKGROUND : CAP_INTERACTIVE;
        if (log.length < cap) { log.push(now); writeLog(log); return; }
        wait = log[log.length - cap] + WINDOW - now + 50; // when enough old requests have aged out
      }
      if (!told && !background && wait > 1500 && api.onWait) { told = true; api.onWait(wait); }
      await sleep(Math.min(Math.max(wait, 100), 5000));
    }
  }

  // ---- persistent subject cache (IndexedDB, falls back to memory only) ----
  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbPromise;
  }
  async function idbGetMany(ids) {
    const db = await openDb();
    if (!db || !ids.length) return [];
    return new Promise((resolve) => {
      const out = [];
      try {
        const tx = db.transaction(STORE, 'readonly');
        const st = tx.objectStore(STORE);
        ids.forEach((id) => {
          const r = st.get(id);
          r.onsuccess = () => { if (r.result && Date.now() - r.result.t < SUBJECT_TTL) out.push(r.result.s); };
        });
        tx.oncomplete = () => resolve(out);
        tx.onerror = tx.onabort = () => resolve(out);
      } catch (e) { resolve([]); }
    });
  }
  async function idbPutMany(items) {
    const db = await openDb();
    if (!db || !items.length) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      const t = Date.now();
      items.forEach((s) => st.put({ id: s.id, t, s }));
    } catch (e) { /* cache is optional */ }
  }
  async function idbClear() {
    const db = await openDb();
    if (!db) return;
    try { db.transaction(STORE, 'readwrite').objectStore(STORE).clear(); } catch (e) { /* ignore */ }
  }

  let flushing = null;
  const inflight = new Map();

  const api = {
    subjectCache: new Map(),
    synonymCache: new Map(), // subject id -> { t, list }
    onWait: null,            // optional hook: called with the wait in ms when a screen has to pause

    get token() { return localStorage.getItem(TOKEN_KEY) || ''; },
    set token(v) {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    },

    /** opts: { method, body, background } */
    request(path, opts) {
      const { method = 'GET', body, background = false } = opts || {};
      const url = path.startsWith('http') ? path : BASE + path;
      // Identical GETs that are already on their way share one request.
      if (method === 'GET' && inflight.has(url)) return inflight.get(url);
      const p = api._send(url, method, body, background);
      if (method === 'GET') {
        inflight.set(url, p);
        const done = () => inflight.delete(url);
        p.then(done, done);
      }
      return p;
    },

    async _send(url, method, body, background) {
      for (let attempt = 0; ; attempt++) {
        await acquire(background);
        let res;
        try {
          res = await fetch(url, {
            method,
            headers: Object.assign(
              { Authorization: 'Bearer ' + api.token, 'Wanikani-Revision': REVISION },
              body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}
            ),
            body: body ? JSON.stringify(body) : undefined,
          });
        } catch (e) {
          throw new ApiError('Could not reach WaniKani. Check your connection and try again.', 0);
        }

        if (res.status === 429) {
          // The limit is per minute, so a short retry is pointless: wait for the window to reset.
          const reset = Number(res.headers.get('RateLimit-Reset')); // epoch seconds, when exposed
          let wait = Number.isFinite(reset) && reset * 1000 > Date.now()
            ? reset * 1000 - Date.now() + 500
            : Math.min(60000, 10000 * 2 ** attempt);
          wait = Math.min(wait, 65000);
          blockedUntil = Math.max(blockedUntil, Date.now() + wait);
          if (attempt < MAX_429_RETRIES) {
            if (!background && api.onWait) api.onWait(wait);
            continue; // acquire() at the top of the loop sleeps until blockedUntil
          }
          throw new ApiError('WaniKani is limiting requests right now. Wait a minute and try again.', 429);
        }
        if (res.status === 401) throw new ApiError('WaniKani rejected your API token. Check that it is correct and still active.', 401);
        if (res.status === 403) throw new ApiError('Your API token is missing a permission for this action. Create a token that allows "assignments:start" and "reviews:create".', 403);
        if (!res.ok) {
          let msg = '';
          try { msg = (await res.json()).error; } catch (e) { /* ignore */ }
          throw new ApiError(msg || 'WaniKani returned an error (HTTP ' + res.status + ').', res.status);
        }
        return res.status === 204 ? null : res.json();
      }
    },

    /** Follow pagination and return every resource in a collection. */
    async list(path, opts) {
      const out = [];
      let url = path;
      while (url) {
        const r = await api.request(url, opts);
        out.push(...r.data);
        url = r.pages && r.pages.next_url;
      }
      return out;
    },

    /** Remember subjects fetched elsewhere (memory and IndexedDB). */
    putSubjects(items) {
      items.forEach((s) => api.subjectCache.set(s.id, s));
      idbPutMany(items);
    },

    /** Fetch subjects by id (cached in memory and in the browser). Returns Map(id -> subject). */
    async getSubjects(ids) {
      const unique = [...new Set(ids)];
      let missing = unique.filter((id) => !api.subjectCache.has(id));
      if (missing.length) {
        const stored = await idbGetMany(missing);
        stored.forEach((s) => api.subjectCache.set(s.id, s));
        missing = missing.filter((id) => !api.subjectCache.has(id));
      }
      for (const part of chunk(missing, 200)) {
        const items = await api.list('/subjects?ids=' + part.join(','));
        api.putSubjects(items);
      }
      const map = new Map();
      unique.forEach((id) => { if (api.subjectCache.has(id)) map.set(id, api.subjectCache.get(id)); });
      return map;
    },

    /** Custom meaning synonyms the user added. Returns Map(subject_id -> string[]). */
    async getSynonyms(ids) {
      const now = Date.now();
      const unique = [...new Set(ids)];
      const missing = unique.filter((id) => { const c = api.synonymCache.get(id); return !c || now - c.t > SYNONYM_TTL; });
      for (const part of chunk(missing, 200)) {
        const items = await api.list('/study_materials?subject_ids=' + part.join(','));
        const found = new Map();
        items.forEach((m) => {
          if (m.data.meaning_synonyms && m.data.meaning_synonyms.length) found.set(m.data.subject_id, m.data.meaning_synonyms);
        });
        part.forEach((id) => api.synonymCache.set(id, { t: now, list: found.get(id) || [] }));
      }
      const map = new Map();
      unique.forEach((id) => { const c = api.synonymCache.get(id); if (c && c.list.length) map.set(id, c.list); });
      return map;
    },

    // ---- review queue: finished reviews are stored locally until WaniKani accepts them ----
    pending() {
      try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; } catch (e) { return []; }
    },
    savePending(list) {
      if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list));
      else localStorage.removeItem(PENDING_KEY);
    },
    queueReview(review) {
      const list = api.pending();
      list.push(review);
      api.savePending(list);
    },
    /** Send queued reviews, paced by the rate limiter. Resolves with how many remain; rejects on transient errors. */
    flushPending() {
      if (flushing) return flushing;
      flushing = (async () => {
        try {
          for (;;) {
            const head = api.pending()[0];
            if (!head) break;
            try {
              await api.request('/reviews', { method: 'POST', body: { review: head }, background: true });
            } catch (e) {
              const permanent = e.status >= 400 && e.status < 500 && ![401, 403, 429].includes(e.status);
              if (!permanent) throw e;
              console.warn('Dropping a review WaniKani refused:', head, e.message);
            }
            // Re-read the queue: new reviews may have been appended while we were waiting.
            const rest = api.pending();
            rest.shift();
            api.savePending(rest);
          }
        } finally {
          flushing = null;
        }
        return api.pending().length;
      })();
      return flushing;
    },

    reset() {
      api.token = '';
      api.subjectCache.clear();
      api.synonymCache.clear();
      localStorage.removeItem(PENDING_KEY);
      idbClear();
    },
  };

  root.api = api;
  root.ApiError = ApiError;
})(window);
