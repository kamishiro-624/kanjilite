/* Dashboard layout: which widgets the home screen shows, in what order, how big, and how much they say.
   Pure logic plus one localStorage key (kl_dash). Kept on this device only, because a phone and a laptop want
   different layouts (it is still included in backup files). Only differences from the defaults are stored.
   Width is a number of columns of a 6-column grid (2 to 6); height is optional, in pixels (none means "as tall as it needs").
   Each widget also has its own undo / redo history (kept in memory while the page is open, not saved) so one widget's
   size, detail, visibility and place can be stepped back without touching the others. */
(function (root) {
  'use strict';

  const KEY = 'kl_dash';
  // In the default order. `levels` lists the amounts of detail a widget offers (1 brief, 2 standard, 3 detailed), and
  // `detail` says in a few words what each one shows. An empty list means the widget has only one.
  // `pinned` widgets can't be hidden.
  const WIDGETS = [
    { id: 'guard', name: 'Workload check', levels: [1, 2, 3], detail: { 1: 'Only the titles of the warnings', 2: 'The top three warnings, with advice', 3: 'Every warning, with advice' } },
    { id: 'plan', name: 'Plan warning', levels: [] },
    { id: 'today', name: 'Today’s plan', levels: [1, 2], detail: { 1: 'Progress bars only', 2: 'Progress bars with notes' } },
    { id: 'todo', name: 'Reviews and lessons', levels: [], pinned: true },
    { id: 'session', name: 'Session length', levels: [1, 2], detail: { 1: 'Just the number box', 2: 'With a hint and a link to more options' } },
    { id: 'practice', name: 'Extra practice', levels: [1, 2], detail: { 1: 'Set names and counts', 2: 'With a description of each set' } },
    { id: 'spread', name: 'Item spread', levels: [1, 2], detail: { 1: 'The table only', 2: 'The table and a note' } },
    { id: 'progress', name: 'Level progress', levels: [1, 2], detail: { 1: 'The bars only', 2: 'The bars and a note about leveling up' } },
    { id: 'numbers', name: 'Your numbers', levels: [1, 2], detail: { 1: 'The four main numbers', 2: 'All the numbers, with details' } },
    { id: 'critical', name: 'Critical condition', levels: [1, 2, 3], detail: { 1: 'Only how many items are under 75%', 2: 'The 8 lowest items', 3: 'The 24 lowest items' } },
    { id: 'upcoming', name: 'Coming up', levels: [1, 2, 3], detail: { 1: 'The next 4 times', 2: 'The next 8 times', 3: 'Every time in the next 24 hours' } },
  ];
  const LEVEL_NAMES = { 1: 'Brief', 2: 'Standard', 3: 'Detailed' };
  const MIN_SPAN = 2, MAX_SPAN = 6, DEFAULT_SPAN = 6;
  const MIN_H = 80, MAX_H = 1600;
  const H_STEP = 20;      // heights snap to multiples of this (pixels)
  const H_MAGNET = 12;    // ...and are pulled to a "magnet" (the fitted height, a neighbour's height) from this close
  const COALESCE_MS = 800; // changes of one kind to one widget within this time count as a single undo step
  const DEFAULT_LEVEL = 2;
  const LEGACY_SPAN = { third: 2, half: 3, full: 6 }; // an earlier version stored these words
  const byId = (id) => WIDGETS.find((w) => w.id === id);
  const defaultOrder = () => WIDGETS.map((w) => w.id);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const asSpan = (v) => (typeof v === 'string' && LEGACY_SPAN[v]) || (Number.isFinite(v) ? clamp(Math.round(v), MIN_SPAN, MAX_SPAN) : DEFAULT_SPAN);
  const asHeight = (v) => (Number.isFinite(v) ? clamp(Math.round(v), MIN_H, MAX_H) : null);

  function read() {
    try { const o = JSON.parse(localStorage.getItem(KEY)); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
  }

  /** The saved layout, always complete and valid: { order: [ids], cfg: { id: { span, h, v, on } } }.
      Unknown ids are dropped, and widgets added in a later version join at the end. */
  function get() {
    const raw = read();
    const seen = new Set();
    const order = (Array.isArray(raw.o) ? raw.o : []).filter((id) => byId(id) && !seen.has(id) && seen.add(id));
    defaultOrder().forEach((id) => { if (!seen.has(id)) order.push(id); });
    const w = raw.w && typeof raw.w === 'object' ? raw.w : {};
    const cfg = {};
    WIDGETS.forEach((def) => {
      const s = w[def.id] && typeof w[def.id] === 'object' ? w[def.id] : {};
      cfg[def.id] = {
        span: asSpan(s.s),
        h: asHeight(s.t),
        v: def.levels.includes(s.v) ? s.v : DEFAULT_LEVEL,
        on: def.pinned ? true : s.h !== 1,
      };
    });
    return { order, cfg };
  }

  function save(state) {
    const out = {};
    const base = defaultOrder();
    if (state.order.some((id, i) => id !== base[i])) out.o = state.order;
    const w = {};
    WIDGETS.forEach((def) => {
      const c = state.cfg[def.id];
      const e = {};
      if (c.span !== DEFAULT_SPAN) e.s = c.span;
      if (c.h != null) e.t = c.h;
      if (c.v !== DEFAULT_LEVEL) e.v = c.v;
      if (!c.on && !def.pinned) e.h = 1;
      if (Object.keys(e).length) w[def.id] = e;
    });
    if (Object.keys(w).length) out.w = w;
    localStorage.setItem(KEY, JSON.stringify(out));
  }

  // ---------- per-widget history ----------
  // A step is a snapshot of one widget before a change: { span, h, v, on, after } where `after` is the widget that sat just
  // before it (null for the first place), so undoing a move puts it back next to the same neighbour.
  const hist = {}; // id -> { u: [undo steps], r: [redo steps] }
  const hOf = (id) => hist[id] || (hist[id] = { u: [], r: [] });
  const snap = (st, id) => {
    const c = st.cfg[id], i = st.order.indexOf(id);
    return { span: c.span, h: c.h, v: c.v, on: c.on, after: i > 0 ? st.order[i - 1] : null };
  };
  const same = (a, b) => a.span === b.span && a.h === b.h && a.v === b.v && a.on === b.on && a.after === b.after;
  const defaultSnap = (id) => {
    const i = defaultOrder().indexOf(id);
    return { span: DEFAULT_SPAN, h: null, v: DEFAULT_LEVEL, on: true, after: i > 0 ? defaultOrder()[i - 1] : null };
  };
  function restore(st, id, s) {
    const def = byId(id), c = st.cfg[id];
    c.span = s.span; c.h = s.h;
    if (def.levels.includes(s.v)) c.v = s.v;
    if (!def.pinned) c.on = s.on;
    st.order.splice(st.order.indexOf(id), 1);
    st.order.splice(s.after && st.order.includes(s.after) ? st.order.indexOf(s.after) + 1 : 0, 0, id);
  }
  /** Remember `before` as an undo step for a widget, unless it is a continuation of the same kind of change a moment ago
      (holding an arrow key, or nudging a size), which stays one step. Any new change drops the redo steps. */
  function record(id, before, kind) {
    const h = hOf(id), now = Date.now(), top = h.u[h.u.length - 1];
    h.r.length = 0;
    if (top && top.kind === kind && now - top.t < COALESCE_MS) { top.t = now; return; }
    h.u.push({ s: before, kind, t: now });
    if (h.u.length > 100) h.u.shift();
  }

  /** Move a widget one place earlier (dir -1) or later (dir 1) among all widgets, hidden ones included. */
  function move(id, dir) {
    const st = get();
    const i = st.order.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= st.order.length) return st;
    const before = snap(st, id);
    st.order.splice(j, 0, st.order.splice(i, 1)[0]);
    record(id, before, 'move');
    save(st);
    return st;
  }

  /** Put a widget just before (or, with after, just after) another one. Used when one is dropped after dragging. */
  function moveTo(id, targetId, after) {
    const st = get();
    if (id === targetId || !st.order.includes(id) || !st.order.includes(targetId)) return st;
    const before = snap(st, id);
    st.order.splice(st.order.indexOf(id), 1);
    st.order.splice(st.order.indexOf(targetId) + (after ? 1 : 0), 0, id);
    if (!same(before, snap(st, id))) record(id, before, 'move');
    save(st);
    return st;
  }

  /** Change one widget: patch is any of { span, h, v, on }. h: null goes back to automatic height.
      Values that don't fit the widget are ignored. */
  function set(id, patch) {
    const st = get();
    const def = byId(id), c = st.cfg[id];
    if (!def) return st;
    const before = snap(st, id);
    const kinds = [];
    if ('span' in patch) { c.span = asSpan(patch.span); kinds.push('span'); }
    if ('h' in patch) { c.h = patch.h == null ? null : asHeight(patch.h); kinds.push('h'); }
    if (def.levels.includes(patch.v)) { c.v = patch.v; kinds.push('v'); }
    if (typeof patch.on === 'boolean' && !def.pinned) { c.on = patch.on; kinds.push('on'); }
    if (!same(before, snap(st, id))) record(id, before, kinds.join('+'));
    save(st);
    return st;
  }

  /** Step one widget back to how it was before its last change (and forward again with redo). Returns the new layout,
      or null when there is nothing to undo / redo. */
  function undo(id) {
    const h = hOf(id), st = get();
    const step = h.u.pop();
    if (!step || !byId(id)) return null;
    h.r.push({ s: snap(st, id), kind: step.kind, t: 0 });
    restore(st, id, step.s);
    save(st);
    return st;
  }
  function redo(id) {
    const h = hOf(id), st = get();
    const step = h.r.pop();
    if (!step || !byId(id)) return null;
    h.u.push({ s: snap(st, id), kind: step.kind, t: 0 });
    restore(st, id, step.s);
    save(st);
    return st;
  }
  const canUndo = (id) => hOf(id).u.length > 0;
  const canRedo = (id) => hOf(id).r.length > 0;

  /** Is this one widget at its default size, detail, visibility and place? */
  function widgetIsDefault(id) { return same(snap(get(), id), defaultSnap(id)); }
  /** Put one widget back to the default size, detail, visibility and place (just after the widget that precedes it by
      default). It is an undo step like any other change. Returns the layout. */
  function resetWidget(id) {
    const st = get();
    if (!byId(id)) return st;
    const before = snap(st, id), d = defaultSnap(id);
    restore(st, id, d);
    if (!same(before, snap(st, id))) record(id, before, 'reset');
    save(st);
    return st;
  }

  /** Everything back to the default. Each widget that changed gets an undo step, so a reset can still be taken back. */
  function reset() {
    const st = get();
    const before = {};
    WIDGETS.forEach((w) => { before[w.id] = snap(st, w.id); });
    localStorage.setItem(KEY, '{}');
    const now = get();
    WIDGETS.forEach((w) => { if (!same(before[w.id], snap(now, w.id))) record(w.id, before[w.id], 'reset'); });
    return now;
  }
  /** Forget every widget's undo history. */
  function clearHistory() { Object.keys(hist).forEach((k) => delete hist[k]); }

  /** Snap a pixel height: to the nearest magnet (a list of { h, ...data }) when one is within H_MAGNET, otherwise to the
      nearest multiple of H_STEP. Returns { h, magnet } (magnet is the entry that caught it, or null). */
  function snapHeight(raw, magnets, free) {
    const clamped = clamp(raw, MIN_H, MAX_H);
    if (free) return { h: Math.round(clamped), magnet: null };
    let best = null;
    (magnets || []).forEach((m) => { const d = Math.abs(m.h - clamped); if (d <= H_MAGNET && (!best || d < best.d)) best = { d, m }; });
    if (best) return { h: clamp(Math.round(best.m.h), MIN_H, MAX_H), magnet: best.m };
    return { h: clamp(Math.round(clamped / H_STEP) * H_STEP, MIN_H, MAX_H), magnet: null };
  }

  function isDefault() { return !Object.keys(read()).length; }

  root.Layout = { WIDGETS, LEVEL_NAMES, MIN_SPAN, MAX_SPAN, DEFAULT_SPAN, MIN_H, MAX_H, H_STEP, H_MAGNET, KEY, get, set, move, moveTo, reset, isDefault, byId, undo, redo, canUndo, canRedo, resetWidget, widgetIsDefault, clearHistory, snapHeight };
})(typeof window !== 'undefined' ? window : globalThis);
