/* Minimal WaniKani API v2 client: throttled requests, pagination, IndexedDB storage, background upload queues.
   The local mirror of your WaniKani data (sync, queries) lives in store.js and sits on top of this file. */
(function (root) {
  'use strict';

  const BASE = 'https://api.wanikani.com/v2';
  const REVISION = '20170710';
  const TOKEN_KEY = 'kl_token';
  const PENDING_KEY = 'kl_pending_reviews';
  const STARTS_KEY = 'kl_pending_starts'; // lessons started locally, waiting to be sent
  const BLOCK_KEY = 'kl_blocked_until';   // shared across tabs: when WaniKani last told us to back off

  // WaniKani allows 60 requests per minute per token. We stay under that on our own, counting requests
  // in localStorage so the budget is shared across tabs and page reloads. Background work (sending
  // finished reviews, nice-to-have lookups) gets a clearly smaller share, and also steps aside whenever
  // a screen is waiting for a request, so finishing a review session never leaves the next screen
  // queued behind the review uploads.
  const WINDOW = 60000;
  const CAP_INTERACTIVE = 54;
  const CAP_BACKGROUND = 40;
  const LOG_KEY = 'kl_req_log';
  const MAX_429_RETRIES = 4;

  const DB_NAME = 'kanjilite';
  const DB_VERSION = 2;
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
  let blockedUntil = 0; // set when WaniKani answers 429 (or says the budget is used up); everything waits
  function getBlocked() {
    let v = blockedUntil;
    try { v = Math.max(v, Number(localStorage.getItem(BLOCK_KEY)) || 0); } catch (e) { /* ignore */ }
    return v;
  }
  function setBlocked(t) {
    blockedUntil = Math.max(blockedUntil, t);
    try { localStorage.setItem(BLOCK_KEY, String(blockedUntil)); } catch (e) { /* ignore */ }
  }
  let interactiveWaiting = 0; // screens currently waiting for a request slot

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
    if (!background) {
      interactiveWaiting++;
      try { return await take(false); } finally { interactiveWaiting--; }
    }
    return take(true);
  }

  async function take(background) {
    let told = false;
    for (;;) {
      const now = Date.now();
      let wait;
      const blocked = getBlocked();
      if (now < blocked) {
        wait = blocked - now;
      } else if (background && interactiveWaiting > 0) {
        wait = 150; // let the screen that is waiting go first
      } else {
        const log = readLog(now);
        const cap = background ? CAP_BACKGROUND : CAP_INTERACTIVE;
        if (log.length < cap) { log.push(now); writeLog(log); return; }
        wait = log[log.length - cap] + WINDOW - now + 50; // when enough old requests have aged out
      }
      if (!told && !background && wait > 1500 && api.onWait) { told = true; api.onWait(wait); }
      await sleep(Math.min(Math.max(wait, 100), background && interactiveWaiting === 0 ? 5000 : 1000));
    }
  }

  // ---- IndexedDB: subjects, assignments, study materials and sync bookkeeping (memory only if unavailable) ----
  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (ev) => {
          const db = req.result;
          // Version 1 cached subjects without a level index and without a sync timestamp; start clean.
          if (ev.oldVersion < 2 && db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('lvl', 'lvl');
          if (!db.objectStoreNames.contains('assignments')) db.createObjectStore('assignments', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('materials')) db.createObjectStore('materials', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        };
        req.onsuccess = () => {
          req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
          resolve(req.result);
        };
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbPromise;
  }

  /** Small promise wrappers. Every one resolves (never rejects) so a broken IndexedDB just means "no cache". */
  const idb = {
    async all(store) {
      const db = await openDb();
      if (!db) return [];
      return new Promise((resolve) => {
        try {
          const r = db.transaction(store, 'readonly').objectStore(store).getAll();
          r.onsuccess = () => resolve(r.result || []);
          r.onerror = () => resolve([]);
        } catch (e) { resolve([]); }
      });
    },
    async byIndex(store, index, value) {
      const db = await openDb();
      if (!db) return [];
      return new Promise((resolve) => {
        try {
          const r = db.transaction(store, 'readonly').objectStore(store).index(index).getAll(IDBKeyRange.only(value));
          r.onsuccess = () => resolve(r.result || []);
          r.onerror = () => resolve([]);
        } catch (e) { resolve([]); }
      });
    },
    async getMany(store, keys) {
      const db = await openDb();
      if (!db || !keys.length) return [];
      return new Promise((resolve) => {
        const out = [];
        try {
          const tx = db.transaction(store, 'readonly');
          const st = tx.objectStore(store);
          keys.forEach((k) => { const r = st.get(k); r.onsuccess = () => { if (r.result) out.push(r.result); }; });
          tx.oncomplete = () => resolve(out);
          tx.onerror = tx.onabort = () => resolve(out);
        } catch (e) { resolve([]); }
      });
    },
    async put(store, items) {
      const db = await openDb();
      if (!db || !items.length) return;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(store, 'readwrite');
          const st = tx.objectStore(store);
          items.forEach((x) => st.put(x));
          tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
        } catch (e) { resolve(); }
      });
    },
    async clear(stores) {
      const db = await openDb();
      if (!db) return;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(stores, 'readwrite');
          stores.forEach((s) => tx.objectStore(s).clear());
          tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
        } catch (e) { resolve(); }
      });
    },
  };

  let flushing = null;
  const inflight = new Map();

  const readQ = (key) => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; } };
  const writeQ = (key, list) => {
    try {
      if (list.length) localStorage.setItem(key, JSON.stringify(list));
      else localStorage.removeItem(key);
    } catch (e) { /* storage full or blocked */ }
  };

  const api = {
    subjectCache: new Map(),
    onWait: null,            // optional hook: called with the wait in ms when a screen has to pause
    onAssignment: null,      // hook: called with every assignment WaniKani sends back after a write
    onSubjectsStored: null,  // hook: called whenever subjects were saved to the browser
    onRefused: null,         // hook: called with (queued item, error) when WaniKani permanently refuses an upload
    refused: 0,              // how many uploads WaniKani has refused since this page was opened
    db: idb,

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

        // When WaniKani exposes its rate-limit headers, trust them over our own count: other apps, scripts
        // and the official site share the same per-token budget. Stop just short of the limit.
        const remaining = res.headers.get('RateLimit-Remaining');
        const resetHdr = Number(res.headers.get('RateLimit-Reset'));
        if (remaining !== null && Number(remaining) <= 1 && Number.isFinite(resetHdr) && resetHdr * 1000 > Date.now()) {
          setBlocked(resetHdr * 1000 + 300);
        }

        if (res.status === 429) {
          // The limit is per minute, so a short retry is pointless: wait for the window to reset.
          let wait = Number.isFinite(resetHdr) && resetHdr * 1000 > Date.now()
            ? resetHdr * 1000 - Date.now() + 500
            : Math.min(30000, 5000 * 2 ** attempt);
          wait = Math.min(wait, 65000);
          setBlocked(Date.now() + wait);
          if (attempt < MAX_429_RETRIES) {
            if (!background && api.onWait) api.onWait(wait);
            continue; // acquire() at the top of the loop sleeps until the block ends
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

    /**
     * Follow pagination and return every resource in a collection. The returned array also carries
     * `dataUpdatedAt`: the collection's timestamp as of the FIRST page, which is what the next
     * incremental `updated_after` sync should start from (anything changed while paging is picked up then).
     * opts.onPage(items, pageNumber) is called as each page arrives.
     */
    async list(path, opts) {
      const out = [];
      let url = path;
      let n = 0;
      while (url) {
        const r = await api.request(url, opts);
        if (n === 0) out.dataUpdatedAt = r.data_updated_at || null;
        out.push(...r.data);
        if (opts && opts.onPage) opts.onPage(r.data, ++n);
        else n++;
        url = r.pages && r.pages.next_url;
      }
      return out;
    },

    /** Remember subjects (memory and IndexedDB). */
    putSubjects(items) {
      items.forEach((s) => api.subjectCache.set(s.id, s));
      const t = Date.now();
      if (api.onSubjectsStored) api.onSubjectsStored();
      return idb.put(STORE, items.map((s) => ({ id: s.id, lvl: s.data && s.data.level, t, s })));
    },

    /** Fetch subjects by id: memory, then IndexedDB, then WaniKani. Returns Map(id -> subject). */
    async getSubjects(ids, opts) {
      const unique = [...new Set(ids)];
      let missing = unique.filter((id) => !api.subjectCache.has(id));
      if (missing.length) {
        const stored = await idb.getMany(STORE, missing);
        stored.forEach((r) => api.subjectCache.set(r.s.id, r.s));
        missing = missing.filter((id) => !api.subjectCache.has(id));
      }
      for (const part of chunk(missing, 200)) {
        const items = await api.list('/subjects?ids=' + part.join(','), opts);
        await api.putSubjects(items);
      }
      const map = new Map();
      unique.forEach((id) => { if (api.subjectCache.has(id)) map.set(id, api.subjectCache.get(id)); });
      return map;
    },

    // ---- upload queues: finished reviews and started lessons are stored locally until WaniKani accepts them ----
    pending() { return readQ(PENDING_KEY); },
    pendingStarts() { return readQ(STARTS_KEY); },
    savePending(list) { writeQ(PENDING_KEY, list); },
    queueReview(review) {
      const list = api.pending();
      list.push(review);
      writeQ(PENDING_KEY, list);
    },
    queueStart(assignmentId) {
      const item = { assignment_id: assignmentId, started_at: new Date().toISOString() };
      const list = api.pendingStarts();
      if (!list.some((x) => x.assignment_id === assignmentId)) list.push(item);
      writeQ(STARTS_KEY, list);
      return item;
    },

    /** The server's copy of an assignment replaces ours (after a write, or when something was refused). */
    _takeAssignment(a) {
      if (a && a.object === 'assignment' && api.onAssignment) api.onAssignment(a);
    },
    _reconcile(id) {
      api.request('/assignments/' + id, { background: true }).then((a) => api._takeAssignment(a)).catch(() => {});
    },

    async _drain(key, send) {
      for (;;) {
        const head = readQ(key)[0];
        if (!head) break;
        try {
          await send(head);
        } catch (e) {
          const permanent = e.status >= 400 && e.status < 500 && ![401, 403, 429].includes(e.status);
          if (!permanent) throw e;
          console.warn('Dropping an update WaniKani refused:', head, e.message);
          api.refused++;
          if (api.onRefused) { try { api.onRefused(head, e); } catch (err) { /* ignore */ } }
          api._reconcile(head.assignment_id); // our local copy of that item may be out of date
        }
        // Re-read the queue: new entries may have been appended while we were waiting.
        const sig = JSON.stringify(head);
        const rest = readQ(key);
        const i = rest.findIndex((x) => JSON.stringify(x) === sig);
        if (i >= 0) rest.splice(i, 1);
        writeQ(key, rest);
      }
    },

    /** Send queued lessons and reviews, paced by the rate limiter. Resolves with how many remain; rejects on transient errors. */
    flushPending() {
      if (flushing) return flushing;
      const run = async () => {
        let first = null;
        const jobs = [
          [STARTS_KEY, async (x) => api._takeAssignment(await api.request(`/assignments/${x.assignment_id}/start`, {
            method: 'PUT', body: { assignment: { started_at: x.started_at } }, background: true }))],
          [PENDING_KEY, async (x) => {
            const post = (review) => api.request('/reviews', { method: 'POST', body: { review }, background: true });
            let r;
            try {
              r = await post(x);
            } catch (e) {
              // A 422 can mean this device's clock runs ahead of WaniKani's, so created_at looks like it is in
              // the future. Try once more and let WaniKani stamp the time itself before giving the review up.
              if (e.status !== 422 || !x.created_at) throw e;
              const rest = Object.assign({}, x);
              delete rest.created_at;
              r = await post(rest);
            }
            if (r && r.resources_updated) api._takeAssignment(r.resources_updated.assignment);
          }],
        ];
        for (const [key, send] of jobs) {
          try { await api._drain(key, send); } catch (e) { first = first || e; }
        }
        if (first) throw first;
      };
      // Only one tab sends at a time, otherwise two tabs would submit the same review twice. A tab that finds
      // the lock taken waits its turn (the queue is re-read once it has the lock) instead of giving up.
      const locked = (fn) => (root.navigator && navigator.locks ? navigator.locks.request('kl_flush', fn) : fn());
      const left = () => api.pending().length + api.pendingStarts().length;
      flushing = (async () => {
        try {
          // Something queued while the last pass was finishing would otherwise sit there until the next
          // page load, so keep going until the queue is really empty (run() throws on transient errors).
          for (let round = 0; ; round++) {
            await locked(run);
            if (!left() || round >= 4) break;
          }
        } finally { flushing = null; }
        return left();
      })();
      return flushing;
    },

    reset() {
      api.token = '';
      api.subjectCache.clear();
      [PENDING_KEY, STARTS_KEY, BLOCK_KEY, 'kl_user', 'kl_session'].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
      try {
        Object.keys(localStorage).filter((k) => k.startsWith('kl_kanji_total_')).forEach((k) => localStorage.removeItem(k));
      } catch (e) { /* ignore */ }
      idb.clear([STORE, 'assignments', 'materials', 'meta']);
    },
  };

  root.api = api;
  root.ApiError = ApiError;
})(window);
