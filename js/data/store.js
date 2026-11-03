/* Local mirror of the parts of your WaniKani account the app needs (assignments, study materials, subjects).

   Why this exists: WaniKani allows 60 requests per minute. Asking the API for "what is due right now" every
   time a screen opens burns that budget and makes every screen wait. Instead:

   - Everything is downloaded once (a handful of requests), kept in memory and IndexedDB, and afterwards only
     what changed is fetched (`updated_after`, usually one request that returns nothing or a few items).
   - Counts, the review forecast, the review and lesson queues and level progress are computed here from that
     data, so those screens open instantly and cost zero requests.
   - When a review or lesson is sent, WaniKani's reply contains the updated assignment; it is merged straight
     into the mirror instead of being fetched again.
   - Finished reviews and started lessons are queued (see api.js) and sent in the background.

   The mirror is always allowed to be a little behind: it is refreshed on start, when the tab regains focus,
   and every few minutes while the dashboard is open. */
(function (root) {
  'use strict';

  const DAY = 24 * 3600 * 1000;
  const HOUR = 3600 * 1000;
  const SUBJECT_CHECK_EVERY = 6 * HOUR;
  const LEVEL_CHUNK = 5; // levels fetched per request (a level has roughly 100 to 300 subjects; pages hold 1000)

  const asg = new Map();       // assignment id -> assignment
  const bySubject = new Map(); // subject id -> assignment
  const materials = new Map(); // subject id -> { id, subject_id, synonyms, meaning_note, reading_note }
  let meta = {};               // sync bookkeeping, persisted in IndexedDB
  const listeners = new Set();

  const enc = encodeURIComponent;
  const iso = (t) => new Date(t).toISOString();

  /** Keep an assignment unless we already hold a newer version of it (a slow, older response must not undo a review). */
  function index(a) {
    const old = asg.get(a.id);
    if (old && old.data_updated_at && a.data_updated_at && Date.parse(a.data_updated_at) < Date.parse(old.data_updated_at)) return false;
    asg.set(a.id, a);
    bySubject.set(a.data.subject_id, a);
    return true;
  }
  function setMeta(key, value) {
    meta[key] = value;
    return api.db.put('meta', [{ key, value }]);
  }

  // Changes are announced at most a few times a second, however many assignments arrive in a burst.
  let emitTimer = null;
  function emit() {
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    }, 250);
  }

  const Local = {
    /** Resolves once what was saved by an earlier visit has been loaded into memory. */
    ready: null,

    /** Subscribe to "your data changed" (a sync brought news, or an upload came back). Returns an unsubscribe function. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** True once a complete first download of assignments has happened. */
    hasData() { return !!meta.asg_at; },

    /** Make sure the saved data belongs to this account; start fresh if a different person logged in. */
    async bind(user) {
      await Local.ready;
      if (meta.account && meta.account !== user.id) await Local.wipe();
      if (meta.account !== user.id) await setMeta('account', user.id);
    },

    async wipe() {
      asg.clear(); bySubject.clear(); materials.clear(); meta = {};
      api.subjectCache.clear();
      await api.db.clear(['subjects', 'assignments', 'materials', 'meta']);
    },

    // ---- queries (all local, no requests) ----

    assignmentFor(subjectId) { return bySubject.get(subjectId) || null; },

    /** Every assignment in the saved copy (for statistics). */
    allAssignments() { return Array.from(asg.values()); },

    /** Assignments you can review right now, minus the ones you already answered that are still being sent. */
    reviewsDue() {
      const t = Date.now();
      const queued = new Set(api.pending().map((r) => r.assignment_id));
      const out = [];
      asg.forEach((a) => {
        const d = a.data;
        if (d.hidden || !d.started_at || !d.available_at || d.srs_stage < 1 || d.srs_stage > 8) return;
        if (Date.parse(d.available_at) > t || queued.has(a.id)) return;
        out.push(a);
      });
      return out;
    },

    /** Lessons that are unlocked and not started yet (including ones whose start is still being sent). */
    lessonsAvailable() {
      const queued = new Set(api.pendingStarts().map((r) => r.assignment_id));
      const out = [];
      asg.forEach((a) => {
        const d = a.data;
        if (d.hidden || d.srs_stage !== 0 || d.started_at || !d.unlocked_at || queued.has(a.id)) return;
        out.push(a);
      });
      return out.sort((x, y) => x.id - y.id);
    },

    /** What the dashboard needs: counts now, the next hours of reviews, and when the next one is due. */
    summary() {
      const t = Date.now();
      const due = Local.reviewsDue().length;
      const queued = new Set(api.pending().map((r) => r.assignment_id));
      const buckets = new Map();
      let next = null;
      asg.forEach((a) => {
        const d = a.data;
        if (d.hidden || !d.started_at || !d.available_at || d.srs_stage < 1 || d.srs_stage > 8 || queued.has(a.id)) return;
        const at = Date.parse(d.available_at);
        if (at <= t) return;
        if (next === null || at < next) next = at;
        if (at - t <= DAY) buckets.set(d.available_at, (buckets.get(d.available_at) || 0) + 1);
      });
      const upcoming = [...buckets.entries()]
        .map(([at, count]) => ({ available_at: at, count }))
        .sort((x, y) => Date.parse(x.available_at) - Date.parse(y.available_at))
        .slice(0, 8);
      return { reviews: due, lessons: Local.lessonsAvailable().length, upcoming, nextReviewsAt: next ? iso(next) : null };
    },

    synonyms(ids) {
      const map = new Map();
      ids.forEach((id) => { const m = materials.get(id); if (m && m.synonyms.length) map.set(id, m.synonyms); });
      return map;
    },

    /** Your synonyms and notes for one subject (always an object, empty when you have none). */
    material(subjectId) {
      const m = materials.get(subjectId);
      return m ? { synonyms: m.synonyms.slice(), meaning_note: m.meaning_note, reading_note: m.reading_note } : { synonyms: [], meaning_note: '', reading_note: '' };
    },

    /**
     * Save your synonyms and/or notes for a subject on WaniKani. `patch` holds any of
     * { synonyms, meaning_note, reading_note }. Nothing changes here until WaniKani has accepted it,
     * so a refusal (for instance a token without the study_materials permissions) leaves everything as it was.
     */
    saveMaterial(subjectId, patch) {
      const run = (Local._matQueue.get(subjectId) || Promise.resolve()).catch(() => {}).then(() => Local._saveMaterial(subjectId, patch));
      Local._matQueue.set(subjectId, run);
      return run;
    },
    _matQueue: new Map(),

    async _saveMaterial(subjectId, patch) {
      await Local.ready;
      const cur = Local.material(subjectId);
      const next = Object.assign({}, cur, patch);
      const fields = { meaning_synonyms: next.synonyms, meaning_note: next.meaning_note, reading_note: next.reading_note };
      let row = materials.get(subjectId);
      let res;
      try {
        if (row && row.id) {
          res = await api.request('/study_materials/' + row.id, { method: 'PUT', body: { study_material: fields } });
        } else {
          res = await api.request('/study_materials', { method: 'POST', body: { study_material: Object.assign({ subject_id: subjectId }, fields) } });
        }
      } catch (e) {
        // This device did not know WaniKani already had a record for the subject. Find it and update it instead.
        if (!(row && row.id) && e && e.status === 422) {
          const found = await api.list('/study_materials?subject_ids=' + subjectId);
          if (!found.length) throw e;
          res = await api.request('/study_materials/' + found[0].id, { method: 'PUT', body: { study_material: fields } });
        } else throw e;
      }
      const m = res && res.data ? res.data : {};
      row = {
        id: res.id,
        subject_id: subjectId,
        synonyms: m.meaning_synonyms || next.synonyms,
        meaning_note: m.meaning_note == null ? next.meaning_note : m.meaning_note,
        reading_note: m.reading_note == null ? next.reading_note : m.reading_note,
      };
      materials.set(subjectId, row);
      await api.db.put('materials', [row]);
      emit();
      return Local.material(subjectId);
    },

    // ---- subjects by level ----

    _levelJobs: new Map(),
    levelDone(lvl) { return (meta.levels || []).includes(lvl); },

    /** Every subject of a level. From IndexedDB when that level was downloaded before, otherwise fetched once. */
    levelSubjects(lvl, opts) {
      if (Local._levelJobs.has(lvl)) return Local._levelJobs.get(lvl);
      const job = (async () => {
        if (Local.levelDone(lvl)) {
          const rows = await api.db.byIndex('subjects', 'lvl', lvl);
          let subs = rows.map((r) => r.s);
          subs.forEach((s) => api.subjectCache.set(s.id, s));
          // If the browser's storage is unavailable (private mode), this visit's memory copy still counts.
          if (!subs.length) subs = [...api.subjectCache.values()].filter((s) => s.data.level === lvl);
          if (subs.length) return subs;
        }
        const subs = await api.list(`/subjects?levels=${lvl}`, opts);
        await api.putSubjects(subs);
        await Local._markLevels([lvl]);
        return subs;
      })();
      Local._levelJobs.set(lvl, job);
      const done = () => Local._levelJobs.delete(lvl);
      job.then(done, done);
      return job;
    },

    async _markLevels(levels) {
      if (!meta.sub_at) await setMeta('sub_at', iso(Date.now() - DAY)); // changes after this moment get picked up later
      const set = new Set(meta.levels || []);
      levels.forEach((l) => set.add(l));
      await setMeta('levels', [...set].sort((a, b) => a - b));
    },

    // ---- syncing ----

    _refreshing: null,
    _lastRefresh: 0,

    /**
     * Bring assignments and study materials up to date. The very first call downloads everything
     * (pass { interactive: true, onProgress } when the person is waiting for it); later calls fetch only changes.
     * Calls that arrive while one is running share it, and calls within `minAge` ms of the last one do nothing.
     */
    refresh(opts) {
      const o = opts || {};
      if (Local._refreshing) return Local._refreshing;
      const minAge = o.force ? 0 : (o.minAge == null ? 90000 : o.minAge);
      if (Local.hasData() && Date.now() - Local._lastRefresh < minAge) return Promise.resolve(false);
      const bg = !o.interactive;
      Local._refreshing = (async () => {
        await Local.ready;
        const a = await Local._syncAssignments(bg, o.onProgress);
        const m = await Local._syncMaterials(bg);
        Local._lastRefresh = Date.now();
        if (a || m) emit();
        return a || m;
      })();
      const done = () => { Local._refreshing = null; };
      Local._refreshing.then(done, done);
      return Local._refreshing;
    },

    async _syncAssignments(bg, onProgress) {
      const first = !meta.asg_at;
      const path = first ? '/assignments' : `/assignments?updated_after=${enc(meta.asg_at)}`;
      let n = 0;
      const items = await api.list(path, {
        background: bg,
        onPage: (page) => { n += page.length; if (onProgress) onProgress(n); },
      });
      await api.db.put('assignments', items.filter((a) => index(a)));
      // Next time, only ask for what changed after this response's own timestamp. An empty first download
      // (brand-new account) has none, so fall back to "a day ago".
      await setMeta('asg_at', items.dataUpdatedAt || (first ? iso(Date.now() - DAY) : meta.asg_at));
      return items.length > 0;
    },

    async _syncMaterials(bg) {
      const first = !meta.mat_at;
      const path = first ? '/study_materials' : `/study_materials?updated_after=${enc(meta.mat_at)}`;
      const items = await api.list(path, { background: bg });
      const rows = items.map((m) => ({
        id: m.id,
        subject_id: m.data.subject_id,
        synonyms: m.data.meaning_synonyms || [],
        meaning_note: m.data.meaning_note || '',
        reading_note: m.data.reading_note || '',
      }));
      rows.forEach((r) => materials.set(r.subject_id, r));
      await api.db.put('materials', rows);
      await setMeta('mat_at', items.dataUpdatedAt || (first ? iso(Date.now() - DAY) : meta.mat_at));
      return items.length > 0;
    },

    /** Subjects changed on WaniKani's side since we saved them (typo fixes, new mnemonics). At most every few hours. */
    async syncSubjectUpdates() {
      if (!meta.sub_at || Date.now() - (meta.sub_checked || 0) < SUBJECT_CHECK_EVERY) return;
      const items = await api.list(`/subjects?updated_after=${enc(meta.sub_at)}`, { background: true });
      if (items.length) await api.putSubjects(items);
      if (items.dataUpdatedAt) await setMeta('sub_at', items.dataUpdatedAt);
      await setMeta('sub_checked', Date.now());
    },

    /**
     * Quietly download the subjects for every level up to the one after yours, a few levels per request,
     * newest levels first. Runs at background priority, so a screen that needs something is never held up by it.
     * Screens work without it (they fetch what they need), this just means they never have to.
     */
    _prefetching: false,
    async prefetchSubjects(user) {
      if (Local._prefetching) return;
      Local._prefetching = true;
      try {
        await Local.ready;
        const granted = user.subscription && user.subscription.max_level_granted;
        const top = Math.min(60, granted || 60, user.level + 1);
        // Your own level first: the dashboard needs it for the progress bar and shares this request.
        await Local.levelSubjects(Math.min(user.level, top), { background: true }).catch(() => {});
        const todo = [];
        for (let l = top; l >= 1; l--) if (!Local.levelDone(l) && !Local._levelJobs.has(l)) todo.push(l);
        for (let i = 0; i < todo.length; i += LEVEL_CHUNK) {
          const part = todo.slice(i, i + LEVEL_CHUNK);
          const subs = await api.list(`/subjects?levels=${part.join(',')}`, { background: true });
          await api.putSubjects(subs);
          await Local._markLevels(part);
        }
        await Local.syncSubjectUpdates();
      } finally {
        Local._prefetching = false;
      }
    },

    // ---- searching across levels ----

    /** Levels whose subjects are saved on this device, sorted. */
    downloadedLevels() { return (meta.levels || []).slice().sort((x, y) => x - y); },

    /** Every subject saved on this device (all levels downloaded so far). */
    async allSubjects() {
      let subs = [];
      try { subs = (await api.db.all('subjects')).map((r) => r.s); } catch (e) { /* storage unavailable */ }
      if (!subs.length) subs = [...api.subjectCache.values()]; // private mode: this visit's memory copy
      subs.forEach((x) => api.subjectCache.set(x.id, x));
      return subs;
    },

    /** Download the subjects of the given levels (a few levels per request). onProgress(doneLevels, totalLevels). */
    async downloadLevels(levels, onProgress) {
      const todo = levels.filter((l) => !Local.levelDone(l));
      let done = 0;
      for (let i = 0; i < todo.length; i += LEVEL_CHUNK) {
        const part = todo.slice(i, i + LEVEL_CHUNK);
        const subs = await api.list(`/subjects?levels=${part.join(',')}`);
        await api.putSubjects(subs);
        await Local._markLevels(part);
        done += part.length;
        if (onProgress) onProgress(done, todo.length);
      }
    },

    // ---- writes that came back from WaniKani, or happened locally and are on their way ----

    /** An assignment as WaniKani now has it (after a review, a lesson start, or a refused write). */
    take(a) {
      if (!index(a)) return;
      api.db.put('assignments', [a]);
      emit();
    },

    /** Show a lesson as started right away; WaniKani's own version replaces this when the upload goes through. */
    markStarted(id, startedAt) {
      const a = asg.get(id);
      if (!a) return;
      const first = Math.ceil((Date.parse(startedAt) + 4 * HOUR) / HOUR) * HOUR; // Apprentice I lasts 4 hours, rounded up to the hour
      const next = { ...a, data: { ...a.data, started_at: startedAt, srs_stage: 1, available_at: iso(first) } };
      index(next);
      api.db.put('assignments', [next]);
      emit();
    },
  };

  Local.ready = (async () => {
    const [rows, mats, metaRows] = await Promise.all([api.db.all('assignments'), api.db.all('materials'), api.db.all('meta')]);
    rows.forEach(index);
    mats.forEach((m) => materials.set(m.subject_id, {
      id: m.id,
      subject_id: m.subject_id,
      synonyms: m.synonyms || [],
      meaning_note: m.meaning_note || '',
      reading_note: m.reading_note || '',
    }));
    metaRows.forEach((r) => { meta[r.key] = r.value; });
    // Study materials saved by an earlier version of the app have no notes. Download them again once.
    if (mats.some((m) => !('meaning_note' in m)) && meta.mat_at) { meta.mat_at = null; api.db.put('meta', [{ key: 'mat_at', value: null }]); }
    // A first download that was interrupted never wrote asg_at, so it simply starts over.
  })();

  api.onAssignment = (a) => Local.take(a);
  // Subjects saved from any path start the clock that later "what changed?" checks count from.
  api.onSubjectsStored = () => Local.ready.then(() => { if (!meta.sub_at) setMeta('sub_at', iso(Date.now() - DAY)); });

  root.Local = Local;
})(window);
