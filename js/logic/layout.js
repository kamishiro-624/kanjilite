/* Dashboard layout: which widgets the home screen shows, in what order, how big, and how much they say.
   Pure logic plus one localStorage key (kl_dash). Kept on this device only, because a phone and a laptop want
   different layouts (it is still included in backup files). Only differences from the defaults are stored.
   Width is a number of columns of a 6-column grid (2 to 6); height is optional, in pixels (none means "as tall as it needs"). */
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

  /** Move a widget one place earlier (dir -1) or later (dir 1) among all widgets, hidden ones included. */
  function move(id, dir) {
    const st = get();
    const i = st.order.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= st.order.length) return st;
    st.order.splice(j, 0, st.order.splice(i, 1)[0]);
    save(st);
    return st;
  }

  /** Put a widget just before (or, with after, just after) another one. Used when one is dropped after dragging. */
  function moveTo(id, targetId, after) {
    const st = get();
    if (id === targetId || !st.order.includes(id) || !st.order.includes(targetId)) return st;
    st.order.splice(st.order.indexOf(id), 1);
    st.order.splice(st.order.indexOf(targetId) + (after ? 1 : 0), 0, id);
    save(st);
    return st;
  }

  /** Change one widget: patch is any of { span, h, v, on }. h: null goes back to automatic height.
      Values that don't fit the widget are ignored. */
  function set(id, patch) {
    const st = get();
    const def = byId(id), c = st.cfg[id];
    if (!def) return st;
    if ('span' in patch) c.span = asSpan(patch.span);
    if ('h' in patch) c.h = patch.h == null ? null : asHeight(patch.h);
    if (def.levels.includes(patch.v)) c.v = patch.v;
    if (typeof patch.on === 'boolean' && !def.pinned) c.on = patch.on;
    save(st);
    return st;
  }

  function reset() { localStorage.setItem(KEY, '{}'); return get(); }
  function isDefault() { return !Object.keys(read()).length; }

  root.Layout = { WIDGETS, LEVEL_NAMES, MIN_SPAN, MAX_SPAN, DEFAULT_SPAN, MIN_H, MAX_H, KEY, get, set, move, moveTo, reset, isDefault, byId };
})(typeof window !== 'undefined' ? window : globalThis);
