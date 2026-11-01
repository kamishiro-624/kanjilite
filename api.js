/* Minimal WaniKani API v2 client: requests, pagination, subject cache, review queue. */
(function (root) {
  'use strict';

  const BASE = 'https://api.wanikani.com/v2';
  const REVISION = '20170710';
  const TOKEN_KEY = 'kl_token';
  const PENDING_KEY = 'kl_pending_reviews';

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

  let flushing = null;

  const api = {
    subjectCache: new Map(),

    get token() { return localStorage.getItem(TOKEN_KEY) || ''; },
    set token(v) {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    },

    async request(path, opts) {
      const { method = 'GET', body } = opts || {};
      const url = path.startsWith('http') ? path : BASE + path;
      for (let attempt = 0; ; attempt++) {
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

        if (res.status === 429 && attempt < 3) {
          const reset = Number(res.headers.get('RateLimit-Reset'));
          const wait = Number.isFinite(reset) && reset > 0
            ? Math.min(Math.max(reset * 1000 - Date.now(), 1000), 15000)
            : 4000;
          await sleep(wait);
          continue;
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
    async list(path) {
      const out = [];
      let url = path;
      while (url) {
        const r = await api.request(url);
        out.push(...r.data);
        url = r.pages && r.pages.next_url;
      }
      return out;
    },

    /** Fetch subjects by id (cached). Returns Map(id -> subject). */
    async getSubjects(ids) {
      const unique = [...new Set(ids)];
      const missing = unique.filter((id) => !api.subjectCache.has(id));
      for (const part of chunk(missing, 100)) {
        const items = await api.list('/subjects?ids=' + part.join(','));
        items.forEach((s) => api.subjectCache.set(s.id, s));
      }
      const map = new Map();
      unique.forEach((id) => { if (api.subjectCache.has(id)) map.set(id, api.subjectCache.get(id)); });
      return map;
    },

    /** Custom meaning synonyms the user added. Returns Map(subject_id -> string[]). */
    async getSynonyms(ids) {
      const map = new Map();
      for (const part of chunk([...new Set(ids)], 100)) {
        const items = await api.list('/study_materials?subject_ids=' + part.join(','));
        items.forEach((m) => {
          if (m.data.meaning_synonyms && m.data.meaning_synonyms.length) {
            map.set(m.data.subject_id, m.data.meaning_synonyms);
          }
        });
      }
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
    /** Send queued reviews. Resolves with how many remain; rejects on transient errors. */
    flushPending() {
      if (flushing) return flushing;
      flushing = (async () => {
        try {
          for (;;) {
            const head = api.pending()[0];
            if (!head) break;
            try {
              await api.request('/reviews', { method: 'POST', body: { review: head } });
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
      localStorage.removeItem(PENDING_KEY);
    },
  };

  root.api = api;
  root.ApiError = ApiError;
})(window);
